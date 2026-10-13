import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { IconComponent } from '../../shared/components/icon.component';
import { sanitizeSvg } from '../../shared/util/sanitize';
import type { DocFile } from '../../core/models';

@Component({
  selector: 'app-image-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    <div class="flex items-center justify-center gap-1 border-b bg-surface px-3 py-1.5">
      <button type="button" class="btn-icon size-8" (click)="zoomBy(-0.2)" title="Zoom out"><app-icon name="zoom-out" [size]="17" /></button>
      <span class="w-14 text-center text-xs tabular-nums text-muted">{{ (zoom() * 100).toFixed(0) }}%</span>
      <button type="button" class="btn-icon size-8" (click)="zoomBy(0.2)" title="Zoom in"><app-icon name="zoom-in" [size]="17" /></button>
      <div class="mx-1 h-5 w-px bg-line"></div>
      <button type="button" class="btn-icon size-8" (click)="rotate(-90)" title="Rotate left"><app-icon name="rotate-ccw" [size]="16" /></button>
      <button type="button" class="btn-icon size-8" (click)="rotate(90)" title="Rotate right"><app-icon name="rotate-cw" [size]="16" /></button>
      <button type="button" class="btn-icon size-8" (click)="reset()" title="Reset"><app-icon name="minimize" [size]="16" /></button>
    </div>

    <div class="grid flex-1 place-items-center overflow-auto bg-surface-2 p-6">
      @if (svgHtml(); as html) {
        <div
          class="transition-transform duration-150"
          [style.transform]="transform()"
          [innerHTML]="html"
        ></div>
      } @else if (url(); as u) {
        <img
          [src]="u"
          [alt]="file().name"
          class="max-h-none select-none shadow-[var(--shadow-pop)] transition-transform duration-150"
          [style.transform]="transform()"
          draggable="false"
        />
      }
    </div>
  `,
})
export class ImageViewerComponent {
  readonly file = input.required<DocFile>();
  readonly blob = input.required<Blob>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly url = signal<string | null>(null);
  protected readonly svgHtml = signal<SafeHtml | null>(null);
  protected readonly zoom = signal(1);
  protected readonly rotation = signal(0);

  protected readonly transform = computed(() => `scale(${this.zoom()}) rotate(${this.rotation()}deg)`);

  constructor() {
    effect((onCleanup) => {
      const blob = this.blob();
      const isSvg = this.file().ext === 'svg' || blob.type.includes('svg');
      this.svgHtml.set(null);
      this.url.set(null);
      if (isSvg) {
        blob.text().then((text) => {
          this.svgHtml.set(this.sanitizer.bypassSecurityTrustHtml(sanitizeSvg(text)));
        });
      } else {
        const u = URL.createObjectURL(blob);
        this.url.set(u);
        onCleanup(() => URL.revokeObjectURL(u));
      }
    });
    this.destroyRef.onDestroy(() => {
      const u = this.url();
      if (u) URL.revokeObjectURL(u);
    });
  }

  protected zoomBy(delta: number): void {
    this.zoom.update((z) => Math.min(5, Math.max(0.2, +(z + delta).toFixed(2))));
  }
  protected rotate(delta: number): void {
    this.rotation.update((r) => (r + delta) % 360);
  }
  protected reset(): void {
    this.zoom.set(1);
    this.rotation.set(0);
  }
}
