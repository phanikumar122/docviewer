import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Minimal inline spinner using the accent colour. */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="spinner" [style.width.px]="size()" [style.height.px]="size()" role="status" aria-label="Loading"></span>`,
  styles: `
    :host {
      display: inline-flex;
    }
    .spinner {
      display: inline-block;
      border-radius: 50%;
      border: 2px solid color-mix(in oklab, var(--accent) 25%, transparent);
      border-top-color: var(--accent);
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation-duration: 1.4s;
      }
    }
  `,
})
export class SpinnerComponent {
  readonly size = input(18);
}
