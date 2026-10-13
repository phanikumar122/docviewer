import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName, formatBytes } from '../../shared/util/format';

@Component({
  selector: 'app-compress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Compress / optimise PDF"
        subtitle="Re-save a PDF, dropping unused objects to reduce its size."
        icon="weight"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Compress' }]"
      />

      <app-pdf-source (itemsChange)="onSource($event)" />

      @if (source()) {
        <div class="card mt-5 p-4">
          <div class="flex items-start gap-2 rounded-[--radius-sm] border border-line bg-surface-2 p-3 text-xs text-muted">
            <app-icon name="info" [size]="15" class="mt-0.5 shrink-0" />
            <span>
              This performs a lossless re-save (removes unused objects and uses object streams). It does
              <strong>not</strong> re-compress embedded images — aggressive image compression requires a
              server-side engine, so savings vary by document.
            </span>
          </div>
          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="weight" [size]="16" /> }
            Optimise PDF
          </button>
        </div>
      }

      @if (result(); as r) {
        <div class="card mt-5 flex items-center justify-around p-4 text-center">
          <div>
            <div class="text-xs text-subtle">Original</div>
            <div class="text-lg font-semibold">{{ formatBytes(r.before) }}</div>
          </div>
          <app-icon name="arrow-right" [size]="18" class="text-subtle" />
          <div>
            <div class="text-xs text-subtle">Optimised</div>
            <div class="text-lg font-semibold">{{ formatBytes(r.after) }}</div>
          </div>
          <div>
            <div class="text-xs text-subtle">Change</div>
            <div class="text-lg font-semibold" [class.text-success]="r.after < r.before">{{ r.delta }}</div>
          </div>
        </div>
      }

      @if (output().length) {
        <div class="mt-5"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class CompressComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);
  protected readonly formatBytes = formatBytes;

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);
  protected readonly result = signal<{ before: number; after: number; delta: string } | null>(null);

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
    this.result.set(null);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    try {
      const bytes = await this.pdf.resave(src.bytes);
      const blob = this.pdf.toBlob(bytes);
      const before = src.size;
      const after = blob.size;
      const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      this.result.set({ before, after, delta: pct > 0 ? `−${pct}%` : 'No reduction' });
      this.output.set([{ name: `${baseName(src.name)}-optimized.pdf`, blob, kindHint: 'optimize' }]);
      this.toast.success('Optimised', pct > 0 ? `${pct}% smaller` : 'Already optimal');
    } catch (e) {
      this.toast.error('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}
