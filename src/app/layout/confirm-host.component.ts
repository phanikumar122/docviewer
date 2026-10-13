import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { IconComponent } from '../shared/components/icon.component';
import { ConfirmService } from '../core/services/confirm.service';

@Component({
  selector: 'app-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (confirm.active(); as c) {
      <div class="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div class="cf-backdrop absolute inset-0 bg-black/55 backdrop-blur-sm" (click)="confirm.respond(false)"></div>
        <div class="cf-panel relative w-full max-w-sm rounded-[--radius-lg] border border-line-strong bg-bg-elevated p-5 shadow-[var(--shadow-pop)]">
          <div class="flex items-start gap-3">
            <div
              class="grid size-10 shrink-0 place-items-center rounded-full"
              [style.background]="c.danger ? 'color-mix(in oklab, var(--danger) 18%, transparent)' : 'var(--accent-soft)'"
              [style.color]="c.danger ? 'var(--danger)' : 'var(--accent-soft-fg)'"
            >
              <app-icon [name]="c.danger ? 'alert-triangle' : 'circle-help'" [size]="20" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="text-base font-semibold">{{ c.title }}</h2>
              @if (c.message) {
                <p class="mt-1 text-sm text-muted">{{ c.message }}</p>
              }
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn btn-outline btn-md" (click)="confirm.respond(false)">
              {{ c.cancelText ?? 'Cancel' }}
            </button>
            <button
              type="button"
              class="btn btn-md"
              [class.btn-primary]="!c.danger"
              [style.background]="c.danger ? 'var(--danger)' : null"
              [style.color]="c.danger ? '#fff' : null"
              (click)="confirm.respond(true)"
            >
              {{ c.confirmText ?? 'Confirm' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .cf-backdrop {
      animation: fade 0.15s ease;
    }
    .cf-panel {
      animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @keyframes pop {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .cf-backdrop,
      .cf-panel {
        animation: none;
      }
    }
  `,
})
export class ConfirmHostComponent {
  protected readonly confirm = inject(ConfirmService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm.active()) this.confirm.respond(false);
  }
}
