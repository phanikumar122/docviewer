import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

type Target = 'image/png' | 'image/jpeg' | 'image/webp';

@Component({
  selector: 'app-image-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Image Tools"
        subtitle="Convert between PNG, JPEG and WEBP, resize and rotate — all in your browser."
        icon="image"
        [crumbs]="[{ label: 'Converters', route: '/converters' }, { label: 'Image Tools' }]"
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
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm">
              <span class="mb-1 block text-muted">Convert to</span>
              <select class="input h-9" [value]="target()" (change)="target.set($any($event.target).value)">
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WEBP</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="mb-1 block text-muted">Rotate</span>
              <select class="input h-9" [value]="rotation()" (change)="rotation.set(+$any($event.target).value)">
                <option [value]="0">None</option>
                <option [value]="90">90° right</option>
                <option [value]="180">180°</option>
                <option [value]="270">90° left</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="mb-1 block text-muted">Max width (px, 0 = keep)</span>
              <input type="number" min="0" [value]="maxWidth()" (input)="maxWidth.set(+$any($event.target).value)" class="input h-9" />
            </label>
            @if (target() !== 'image/png') {
              <label class="block text-sm">
                <span class="mb-1 block text-muted">Quality ({{ (quality() * 100).toFixed(0) }}%)</span>
                <input type="range" min="0.3" max="1" step="0.05" [value]="quality()" (input)="quality.set(+$any($event.target).value)" class="w-full" />
              </label>
            }
          </div>
          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="replace" [size]="16" /> }
            Convert {{ sources().length }} image(s)
          </button>
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class ImageToolsComponent {
  private readonly toast = inject(ToastService);

  protected readonly sources = signal<SourceItem[]>([]);
  protected readonly target = signal<Target>('image/png');
  protected readonly rotation = signal(0);
  protected readonly maxWidth = signal(0);
  protected readonly quality = signal(0.9);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async run(): Promise<void> {
    if (!this.sources().length) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const ext = this.target() === 'image/png' ? 'png' : this.target() === 'image/jpeg' ? 'jpg' : 'webp';
      const outputs: ToolOutput[] = [];
      for (const src of this.sources()) {
        const blob = await this.convert(src);
        outputs.push({ name: `${baseName(src.name)}.${ext}`, blob, kindHint: 'image' });
      }
      this.output.set(outputs);
      this.toast.success('Images converted', `${outputs.length} file(s)`);
    } catch (e) {
      this.toast.error('Conversion failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }

  private async convert(src: SourceItem): Promise<Blob> {
    const url = URL.createObjectURL(new Blob([src.bytes]));
    try {
      const img = await this.load(url);
      const rot = this.rotation();
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (this.maxWidth() > 0 && w > this.maxWidth()) {
        const scale = this.maxWidth() / w;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      const swap = rot === 90 || rot === 270;
      canvas.width = swap ? h : w;
      canvas.height = swap ? w : h;
      const ctx = canvas.getContext('2d')!;
      if (this.target() === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, this.target(), this.target() === 'image/png' ? undefined : this.quality()),
      );
      if (!blob) throw new Error('Could not encode image');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private load(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
  }
}
