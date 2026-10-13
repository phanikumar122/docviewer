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
  selector: 'app-watermark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Add watermark"
        subtitle="Overlay a text watermark across every page of a PDF."
        icon="stamp"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Add watermark' }]"
      />

      <app-pdf-source (itemsChange)="onSource($event)" />

      @if (source()) {
        <div class="card mt-5 p-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Watermark text</span>
              <input type="text" [value]="text()" (input)="text.set($any($event.target).value)" class="input h-9" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Colour</span>
              <input type="color" [value]="color()" (input)="color.set($any($event.target).value)" class="h-9 w-full rounded-[--radius-sm] border border-line bg-surface-2" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Opacity: {{ (opacity() * 100).toFixed(0) }}%</span>
              <input type="range" min="0.05" max="1" step="0.05" [value]="opacity()" (input)="opacity.set(+$any($event.target).value)" class="w-full" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Font size: {{ fontSize() }}pt</span>
              <input type="range" min="12" max="120" step="2" [value]="fontSize()" (input)="fontSize.set(+$any($event.target).value)" class="w-full" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-muted">Rotation: {{ rotation() }}°</span>
              <input type="range" min="-90" max="90" step="5" [value]="rotation()" (input)="rotation.set(+$any($event.target).value)" class="w-full" />
            </label>
          </div>

          <div class="mt-4">
            <span class="mb-1 block text-xs font-medium text-muted">Preview</span>
            <div class="relative grid h-28 place-items-center overflow-hidden rounded-[--radius-md] border bg-surface-2">
              <span
                class="select-none font-bold"
                [style.color]="color()"
                [style.opacity]="opacity()"
                [style.transform]="'rotate(' + rotation() + 'deg)'"
                [style.fontSize.px]="Math.min(fontSize(), 40)"
              >{{ text() || 'WATERMARK' }}</span>
            </div>
          </div>

          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy() || !text()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="stamp" [size]="16" /> }
            Add watermark
          </button>
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class WatermarkComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);
  protected readonly Math = Math;

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly text = signal('CONFIDENTIAL');
  protected readonly color = signal('#5b4ee6');
  protected readonly opacity = signal(0.3);
  protected readonly fontSize = signal(48);
  protected readonly rotation = signal(45);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    try {
      const { r, g, b } = hexToRgb(this.color());
      const bytes = await this.pdf.addWatermark(src.bytes, {
        text: this.text(),
        opacity: this.opacity(),
        fontSize: this.fontSize(),
        rotation: this.rotation(),
        color: { r, g, b },
      });
      this.output.set([{ name: `${baseName(src.name)}-watermarked.pdf`, blob: this.pdf.toBlob(bytes), kindHint: 'edit' }]);
      this.toast.success('Watermark added');
    } catch (e) {
      this.toast.error('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0.36, g: 0.3, b: 0.9 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
