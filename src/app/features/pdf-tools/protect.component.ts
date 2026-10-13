import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { EngineGateComponent } from './engine-gate.component';
import { PdfBackendService } from '../../core/services/pdf-backend.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

type Mode = 'protect' | 'unlock';

@Component({
  selector: 'app-protect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent, EngineGateComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Password Protect"
        subtitle="Encrypt a PDF with a password, set permissions, or remove an existing password."
        icon="lock"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Protect / Unlock' }]"
      />

      <div class="mb-4 inline-flex rounded-[--radius-md] border bg-surface-2 p-1 text-sm">
        <button type="button" class="rounded-[--radius-sm] px-3 py-1.5 font-medium" [style.background]="mode() === 'protect' ? 'var(--surface)' : null" [class.text-fg]="mode() === 'protect'" [class.text-subtle]="mode() !== 'protect'" (click)="setMode('protect')">
          <app-icon name="lock" [size]="14" class="mr-1 inline" /> Protect
        </button>
        <button type="button" class="rounded-[--radius-sm] px-3 py-1.5 font-medium" [style.background]="mode() === 'unlock' ? 'var(--surface)' : null" [class.text-fg]="mode() === 'unlock'" [class.text-subtle]="mode() !== 'unlock'" (click)="setMode('unlock')">
          <app-icon name="lock-open" [size]="14" class="mr-1 inline" /> Unlock
        </button>
      </div>

      <app-engine-gate [feature]="mode()" />

      @if (!source()) {
        <app-pdf-source (itemsChange)="onSource($event)" />
      }

      @if (source(); as src) {
        <div class="card mb-4 p-4">
          <div class="mb-3 flex items-center gap-3">
            <app-icon name="file-text" [size]="20" class="text-accent-soft-fg" />
            <span class="min-w-0 truncate text-sm font-medium">{{ src.name }}</span>
            <button type="button" class="btn btn-outline btn-sm ml-auto" (click)="reset()">Change file</button>
          </div>

          @if (mode() === 'protect') {
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Password (required to open the PDF)</span>
              <input class="input h-9" type="password" [value]="password()" (input)="password.set($any($event.target).value)" placeholder="choose a strong password" autocomplete="new-password" />
            </label>
            <div class="mt-3 space-y-2 text-sm">
              <div class="text-xs font-medium text-muted">Allow holders of the password to:</div>
              <label class="flex items-center gap-2"><input type="checkbox" [checked]="allowPrint()" (change)="allowPrint.set($any($event.target).checked)" /> Print</label>
              <label class="flex items-center gap-2"><input type="checkbox" [checked]="allowCopy()" (change)="allowCopy.set($any($event.target).checked)" /> Copy text &amp; images</label>
              <label class="flex items-center gap-2"><input type="checkbox" [checked]="allowModify()" (change)="allowModify.set($any($event.target).checked)" /> Modify &amp; annotate</label>
            </div>
            <button type="button" class="btn btn-primary btn-md mt-4 w-full" [disabled]="busy() || !password() || engineStatus() !== 'up'" (click)="protect()">
              @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="lock" [size]="16" /> }
              Protect PDF
            </button>
          } @else {
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Current password</span>
              <input class="input h-9" type="password" [value]="password()" (input)="password.set($any($event.target).value)" placeholder="the password used to open this PDF" autocomplete="off" (keydown.enter)="unlock()" />
            </label>
            <button type="button" class="btn btn-primary btn-md mt-4 w-full" [disabled]="busy() || engineStatus() !== 'up'" (click)="unlock()">
              @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="lock-open" [size]="16" /> }
              Remove password
            </button>
          }
        </div>
      }

      @if (output().length) {
        <app-tool-result [outputs]="output()" />
      }
    </div>
  `,
})
export class ProtectComponent {
  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);

  protected readonly mode = signal<Mode>('protect');
  protected readonly source = signal<SourceItem | null>(null);
  protected readonly password = signal('');
  protected readonly allowPrint = signal(true);
  protected readonly allowCopy = signal(true);
  protected readonly allowModify = signal(true);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);
  protected readonly engineStatus = this.backend.status;

  protected setMode(m: Mode): void {
    this.mode.set(m);
    this.password.set('');
    this.output.set([]);
  }

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected reset(): void {
    this.source.set(null);
    this.output.set([]);
  }

  protected async protect(): Promise<void> {
    const src = this.source();
    if (!src || !this.password()) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const bytes = await this.backend.protect(src.bytes, {
        userPassword: this.password(),
        allowPrint: this.allowPrint(),
        allowCopy: this.allowCopy(),
        allowModify: this.allowModify(),
      });
      const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
      this.output.set([{ name: `${baseName(src.name)}-protected.pdf`, blob, kindHint: 'edit' }]);
      this.toast.success('PDF protected', 'The downloaded file now requires the password to open.');
    } catch (e) {
      this.toast.error('Could not protect', e instanceof Error ? e.message : 'Engine error.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async unlock(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const { bytes, wasEncrypted } = await this.backend.unlock(src.bytes, this.password());
      const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
      this.output.set([{ name: `${baseName(src.name)}-unlocked.pdf`, blob, kindHint: 'edit' }]);
      this.toast.success(wasEncrypted ? 'Password removed' : 'No password found', wasEncrypted ? 'The downloaded PDF opens without a password.' : 'This PDF was not encrypted; a clean copy was saved.');
    } catch (e) {
      this.toast.error('Could not unlock', e instanceof Error ? e.message : 'Wrong password or engine error.');
    } finally {
      this.busy.set(false);
    }
  }
}
