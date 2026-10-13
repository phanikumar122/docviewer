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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Component({
  selector: 'app-pdf-to-word',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent, EngineGateComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="PDF to Word"
        subtitle="Convert a PDF into an editable Word document (.docx / .doc) — text, layout, tables and images."
        icon="file-type"
        [crumbs]="[{ label: 'Converters', route: '/converters' }, { label: 'PDF to Word' }]"
      />

      <app-engine-gate feature="pdfToWord" />

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
          <div class="mb-3 flex items-center gap-4 text-xs">
            <span class="font-medium text-muted">Output format:</span>
            <label class="inline-flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="word-fmt" value="docx" [checked]="format() === 'docx'" (change)="format.set('docx')" />
              <span class="font-medium">.docx (Standard Word)</span>
            </label>
            <label class="inline-flex cursor-pointer items-center gap-1.5">
              <input type="radio" name="word-fmt" value="doc" [checked]="format() === 'doc'" (change)="format.set('doc')" />
              <span class="font-medium">.doc (Legacy Word)</span>
            </label>
          </div>
          <label class="block text-sm">
            <span class="mb-1 block text-xs font-medium text-muted">Password (only if the PDF is protected)</span>
            <input class="input h-9" type="password" [value]="password()" (input)="password.set($any($event.target).value)" placeholder="leave blank if none" autocomplete="off" />
          </label>
          <button type="button" class="btn btn-primary btn-md mt-4 w-full" [disabled]="busy() || engineStatus() !== 'up'" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="arrow-right-left" [size]="16" /> }
            Convert to Word
          </button>
        </div>
      }

      @if (output().length) {
        <app-tool-result [outputs]="output()" />
      }
    </div>
  `,
})
export class PdfToWordComponent {
  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly format = signal<'docx' | 'doc'>('docx');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);
  protected readonly engineStatus = this.backend.status;

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected reset(): void {
    this.source.set(null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const bytes = await this.backend.pdfToWord(src.bytes, this.password());
      const ext = this.format();
      const mime = ext === 'doc' ? 'application/msword' : DOCX_MIME;
      const blob = new Blob([bytes.slice().buffer], { type: mime });
      this.output.set([{ name: `${baseName(src.name)}.${ext}`, blob, kindHint: 'convert' }]);
      this.toast.success('Converted to Word', `Download your .${ext} below.`);
    } catch (e) {
      this.toast.error('Conversion failed', e instanceof Error ? e.message : 'Could not reach the engine.');
    } finally {
      this.busy.set(false);
    }
  }
}
