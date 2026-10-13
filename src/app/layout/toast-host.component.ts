import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../shared/components/icon.component';
import { ToastService } from '../core/services/toast.service';

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-2',
  },
  template: `
    @for (t of toast.toasts(); track t.id) {
      <div
        class="toast pointer-events-auto flex items-start gap-3 rounded-[--radius-md] border bg-bg-elevated p-3 shadow-[var(--shadow-pop)]"
        [class.border-line]="t.kind === 'info' || t.kind === 'loading'"
        role="status"
      >
        <span
          class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full"
          [style.background]="bg(t.kind)"
          [style.color]="fg(t.kind)"
        >
          <app-icon [name]="t.icon ?? 'info'" [size]="16" [class]="t.kind === 'loading' ? 'animate-spin' : ''" />
        </span>
        <div class="min-w-0 flex-1 pt-0.5">
          <div class="text-sm font-medium">{{ t.title }}</div>
          @if (t.message) {
            <div class="mt-0.5 text-xs text-muted">{{ t.message }}</div>
          }
        </div>
        <button type="button" class="btn-icon size-6 text-subtle hover:text-fg" (click)="toast.dismiss(t.id)" aria-label="Dismiss">
          <app-icon name="x" [size]="14" />
        </button>
      </div>
    }
  `,
  styles: `
    .toast {
      animation: toast-in 0.26s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `,
})
export class ToastHostComponent {
  protected readonly toast = inject(ToastService);

  protected bg(kind: string): string {
    const map: Record<string, string> = {
      success: 'color-mix(in oklab, var(--success) 20%, transparent)',
      error: 'color-mix(in oklab, var(--danger) 20%, transparent)',
      info: 'color-mix(in oklab, var(--info) 20%, transparent)',
      loading: 'var(--surface-2)',
    };
    return map[kind] ?? 'var(--surface-2)';
  }
  protected fg(kind: string): string {
    const map: Record<string, string> = {
      success: 'var(--success)',
      error: 'var(--danger)',
      info: 'var(--info)',
      loading: 'var(--fg-muted)',
    };
    return map[kind] ?? 'var(--fg-muted)';
  }
}
