import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { gsap } from 'gsap';

/**
 * Staggered entrance animation for a container's direct children, using GSAP.
 * Honours prefers-reduced-motion and cleans up its own context on destroy.
 *
 * Usage: `<div appReveal>…cards…</div>` or `[appReveal]="'.stat'"` to target
 * specific descendants.
 */
@Directive({
  selector: '[appReveal]',
})
export class RevealDirective {
  /** Optional selector for the elements to animate (defaults to direct children). */
  readonly appReveal = input<string>('');
  private readonly host = inject(ElementRef<HTMLElement>);
  private ctx: gsap.Context | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.ctx?.revert());

    afterNextRender(() => {
      const reduce =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;

      const el = this.host.nativeElement as HTMLElement;
      const selector = this.appReveal();
      const targets = selector ? el.querySelectorAll(selector) : (Array.from(el.children) as Element[]);
      if (!targets || (targets as ArrayLike<Element>).length === 0) return;

      this.ctx = gsap.context(() => {
        gsap.from(targets as gsap.TweenTarget, {
          y: 14,
          opacity: 0,
          duration: 0.5,
          ease: 'power2.out',
          stagger: 0.06,
          clearProps: 'transform,opacity',
        });
      }, el);
    });
  }
}
