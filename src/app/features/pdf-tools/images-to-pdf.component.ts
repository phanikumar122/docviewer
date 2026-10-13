import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-images-to-pdf',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Images to PDF"
        subtitle="Combine PNG, JPG, WEBP or GIF images into a single PDF, one image per page."
        icon="image-plus"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Images to PDF' }]"
      />

      <app-pdf-source
        [multiple]="true"
        [kinds]="['image']"
        accept="image/*"
        label="Drag & drop images here"
        (itemsChange)="sources.set($event)"
      />

      @if (sources().length) {
        <div class="card mt-5 p-4">
          <div class="mb-3 text-sm font-medium">Page layout</div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-primary]="pageSize() === 'fit'"
              [class.btn-outline]="pageSize() !== 'fit'"
              (click)="pageSize.set('fit')"
            >
              Fit to image
            </button>
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-primary]="pageSize() === 'a4'"
              [class.btn-outline]="pageSize() !== 'a4'"
              (click)="pageSize.set('a4')"
            >
              A4 pages
            </button>
          </div>
          @if (pageSize() === 'a4') {
            <label class="mt-4 block text-sm">
              <span class="mb-1 block text-muted">Margin ({{ margin() }}pt)</span>
              <input type="range" min="0" max="80" [value]="margin()" (input)="margin.set(+$any($event.target).value)" class="w-full" />
            </label>
          }
          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="file-output" [size]="16" /> }
            Create PDF from {{ sources().length }} image(s)
          </button>
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class ImagesToPdfComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly sources = signal<SourceItem[]>([]);
  protected readonly pageSize = signal<'fit' | 'a4'>('fit');
  protected readonly margin = signal(24);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async run(): Promise<void> {
    if (!this.sources().length) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const images = this.sources().map((s) => ({ bytes: s.bytes, mime: mimeFor(s.name) }));
      const bytes = await this.pdf.imagesToPdf(images, { pageSize: this.pageSize(), margin: this.margin() });
      this.output.set([{ name: 'images.pdf', blob: this.pdf.toBlob(bytes), kindHint: 'convert' }]);
      this.toast.success('PDF created', `${images.length} images`);
    } catch (e) {
      this.toast.error('Conversion failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return map[ext] ?? 'image/png';
}
