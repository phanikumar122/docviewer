import { gsap } from 'gsap';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Staggered fade/slide-in reveal for a set of elements. No-op (elements just
 * shown) when the user prefers reduced motion. Returns the timeline so callers
 * can kill it on destroy if needed.
 */
export function gsapReveal(targets: ArrayLike<Element>, opts: { y?: number; stagger?: number } = {}): gsap.core.Tween | null {
  if (!targets || targets.length === 0) return null;
  if (prefersReducedMotion()) {
    gsap.set(targets, { opacity: 1, clearProps: 'transform' });
    return null;
  }
  return gsap.fromTo(
    targets,
    { opacity: 0, y: opts.y ?? 14 },
    { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: opts.stagger ?? 0.06, clearProps: 'transform' },
  );
}
