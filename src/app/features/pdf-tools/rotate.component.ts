import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

interface Thumb {
  pageNumber: number;
  dataUrl: string;
  rotation: number;
}

@Component({
  selector: 'app-rotate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Rotate pages"
        subtitle="Rotate individual pages or the whole document, then export a new PDF."
        icon="rotate-cw"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Rotate pages' }]"
      />

      @if (!source()) {
        <app-pdf-source (itemsChange)="onSource($event)" />
      }

      @if (loading()) {
        <div class="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <app-spinner [size]="18" /> Rendering pages…
        </div>
      }

      @if (source() && !loading()) {
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-outline btn-sm" (click)="rotateAll(-90)">
            <app-icon name="rotate-ccw" [size]="15" /> Rotate all left
          </button>
          <button type="button" class="btn btn-outline btn-sm" (click)="rotateAll(90)">
            <app-icon name="rotate-cw" [size]="15" /> Rotate all right
          </button>
          <button type="button" class="btn btn-outline btn-sm" (click)="reset()">Clear</button>
          <button type="button" class="btn btn-primary btn-sm ml-auto" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="15" /> } @else { <app-icon name="check" [size]="15" /> }
            Apply & export
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          @for (thumb of thumbs(); track thumb.pageNumber) {
            <div class="group rounded-[--radius-md] border bg-surface p-2">
              <div class="relative mb-2 grid aspect-[3/4] place-items-center overflow-hidden rounded bg-surface-2">
                <img
                  [src]="thumb.dataUrl"
                  [alt]="'Page ' + thumb.pageNumber"
                  class="max-h-full max-w-full transition-transform duration-200"
                  [style.transform]="'rotate(' + thumb.rotation + 'deg)'"
                  loading="lazy"
                />
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-subtle">Page {{ thumb.pageNumber }}</span>
                <div class="flex gap-0.5">
                  <button type="button" class="btn-icon size-7" (click)="rotateOne(thumb, -90)" title="Rotate left">
                    <app-icon name="rotate-ccw" [size]="14" />
                  </button>
                  <button type="button" class="btn-icon size-7" (click)="rotateOne(thumb, 90)" title="Rotate right">
                    <app-icon name="rotate-cw" [size]="14" />
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class RotateComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly thumbs = signal<Thumb[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async onSource(items: SourceItem[]): Promise<void> {
    const src = items[0] ?? null;
    this.source.set(src);
    this.output.set([]);
    if (!src) return;
    this.loading.set(true);
    try {
      const pages = await this.pdf.renderPages(src.bytes, 0.5);
      this.thumbs.set(pages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl, rotation: 0 })));
    } catch {
      this.toast.error('Could not render PDF', 'The file may be corrupt or protected.');
      this.source.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected rotateOne(thumb: Thumb, delta: number): void {
    this.thumbs.update((list) =>
      list.map((t) => (t.pageNumber === thumb.pageNumber ? { ...t, rotation: (t.rotation + delta + 360) % 360 } : t)),
    );
  }

  protected rotateAll(delta: number): void {
    this.thumbs.update((list) => list.map((t) => ({ ...t, rotation: (t.rotation + delta + 360) % 360 })));
  }

  protected reset(): void {
    this.thumbs.update((list) => list.map((t) => ({ ...t, rotation: 0 })));
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    try {
      const rotations = new Map<number, number>();
      this.thumbs().forEach((t) => {
        if (t.rotation) rotations.set(t.pageNumber - 1, t.rotation);
      });
      const bytes = await this.pdf.rotatePages(src.bytes, rotations);
      this.output.set([{ name: `${baseName(src.name)}-rotated.pdf`, blob: this.pdf.toBlob(bytes), kindHint: 'rotate' }]);
      this.toast.success('Rotation applied');
    } catch (e) {
      this.toast.error('Rotate failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}
