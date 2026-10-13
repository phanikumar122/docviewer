import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  action: () => void;
}

/** Anchored popup menu positioned at viewport coordinates, with a backdrop. */
@Component({
  selector: 'app-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="fixed inset-0 z-[65]" (click)="closed.emit()" (contextmenu)="$event.preventDefault(); closed.emit()">
      <div
        class="menu absolute min-w-44 overflow-hidden rounded-[--radius-md] border border-line-strong bg-bg-elevated py-1 shadow-[var(--shadow-pop)]"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        (click)="$event.stopPropagation()"
      >
        @for (item of items(); track item.label) {
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
            [class.text-danger]="item.danger"
            (click)="run(item)"
          >
            @if (item.icon) {
              <app-icon [name]="item.icon" [size]="16" [class]="item.danger ? '' : 'text-muted'" />
            }
            {{ item.label }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    .menu {
      animation: menu-in 0.12s ease-out;
    }
    @keyframes menu-in {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .menu {
        animation: none;
      }
    }
  `,
})
export class ContextMenuComponent {
  readonly x = input(0);
  readonly y = input(0);
  readonly items = input<MenuItem[]>([]);
  readonly closed = output<void>();

  /** Clamp so the menu stays within the viewport. */
  protected readonly pos = computed(() => {
    const w = 180;
    const h = this.items().length * 38 + 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
    return {
      left: Math.min(this.x(), vw - w - 8),
      top: Math.min(this.y(), vh - h - 8),
    };
  });

  protected run(item: MenuItem): void {
    this.closed.emit();
    item.action();
  }
}
