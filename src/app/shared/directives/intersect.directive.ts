import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

/**
 * Fires once the host element first scrolls into view within an optional root
 * scroller. Used for lazy work (e.g. rendering a PDF thumbnail only when its
 * slot becomes visible) so large documents don't render every page up front.
 *
 * Usage: `<button appIntersect [root]="scroller" (intersect)="render()">`
 * The emit happens a single time per element lifetime; destroy/recreate the
 * element (e.g. via a changing `track` key) to arm it again for a new document.
 */
@Directive({
  selector: '[appIntersect]',
})
export class IntersectDirective {
  /** Scroll container to observe within; defaults to the viewport. */
  readonly root = input<HTMLElement | null>(null);
  /** Pre-load margin so work starts just before the element is visible. */
  readonly rootMargin = input<string>('200px');
  readonly intersect = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private observer: IntersectionObserver | null = null;
  private fired = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());

    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        // No observer support → render eagerly so content still appears.
        this.emitOnce();
        return;
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) this.emitOnce();
        },
        { root: this.root() ?? null, rootMargin: this.rootMargin() },
      );
      this.observer.observe(this.host.nativeElement);
    });
  }

  private emitOnce(): void {
    if (this.fired) return;
    this.fired = true;
    this.observer?.disconnect();
    this.intersect.emit();
  }
}
