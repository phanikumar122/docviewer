import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

@Component({
  selector: 'app-pdf-to-images',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="PDF to Images"
        subtitle="Render each page of a PDF to a PNG or JPEG image."
        icon="image"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'PDF to Images' }]"
      />

      <app-pdf-source (itemsChange)="onSource($event)" />

      @if (source()) {
        <div class="card mt-5 p-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm">
              <span class="mb-1 block text-muted">Format</span>
              <select class="input h-9" [value]="format()" (change)="format.set($any($event.target).value)">
                <option value="image/png">PNG (lossless)</option>
                <option value="image/jpeg">JPEG (smaller)</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="mb-1 block text-muted">Resolution ({{ scaleLabel() }})</span>
              <select class="input h-9" [value]="scale()" (change)="scale.set(+$any($event.target).value)">
                <option [value]="1">Screen (1x)</option>
                <option [value]="1.5">High (1.5x)</option>
                <option [value]="2">Print (2x)</option>
                <option [value]="3">Max (3x)</option>
              </select>
            </label>
          </div>
          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="image" [size]="16" /> }
            Export pages as images
          </button>
          @if (busy()) {
            <p class="mt-2 text-xs text-subtle">Rendering {{ progress() }}…</p>
          }
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class PdfToImagesComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly format = signal<'image/png' | 'image/jpeg'>('image/png');
  protected readonly scale = signal(1.5);
  protected readonly busy = signal(false);
  protected readonly progress = signal('');
  protected readonly output = signal<ToolOutput[]>([]);

  protected scaleLabel(): string {
    return `${this.scale()}x`;
  }

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const pages = await this.pdf.renderPages(src.bytes, this.scale(), undefined, this.format(), 0.9);
      const ext = this.format() === 'image/png' ? 'png' : 'jpg';
      const stem = baseName(src.name);
      const outputs: ToolOutput[] = [];
      for (const p of pages) {
        this.progress.set(`page ${p.pageNumber} of ${pages.length}`);
        const blob = await (await fetch(p.dataUrl)).blob();
        outputs.push({ name: `${stem}-p${p.pageNumber}.${ext}`, blob, kindHint: 'convert' });
      }
      this.output.set(outputs);
      this.toast.success('Export complete', `${outputs.length} images`);
    } catch (e) {
      this.toast.error('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
      this.progress.set('');
    }
  }
}
