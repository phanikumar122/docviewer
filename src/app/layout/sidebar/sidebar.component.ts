import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { UiStateService } from '../../core/services/ui-state.service';
import { NAV_SECTIONS } from '../nav.config';

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  host: {
    class: 'flex h-full w-full flex-col bg-surface',
  },
  template: `
    <!-- Brand -->
    <div class="flex h-16 items-center gap-2.5 px-4">
      <div
        class="grid size-9 shrink-0 place-items-center rounded-[--radius-sm] text-white"
        style="background: linear-gradient(135deg, var(--accent), var(--accent-hover))"
      >
        <app-icon name="files" [size]="19" />
      </div>
      @if (!collapsed()) {
        <div class="min-w-0">
          <div class="truncate text-[15px] font-semibold leading-tight">DocuFlow</div>
          <div class="truncate text-[11px] text-subtle">Document workspace</div>
        </div>
      }
    </div>

    <!-- Nav -->
    <nav class="flex-1 overflow-y-auto px-3 py-2">
      @for (section of sections; track section.label) {
        <div class="mb-1.5">
          @if (section.label && !collapsed()) {
            <div class="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {{ section.label }}
            </div>
          } @else if (section.label && collapsed()) {
            <div class="mx-2 my-2 border-t"></div>
          }
          @for (item of section.items; track item.route) {
            <a
              [routerLink]="item.route"
              routerLinkActive="active-nav"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              (click)="onNavigate()"
              class="group relative mb-0.5 flex items-center gap-3 rounded-[--radius-sm] px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              [class.justify-center]="collapsed()"
              [attr.title]="collapsed() ? item.label : null"
            >
              <app-icon [name]="item.icon" [size]="18" class="transition-colors" />
              @if (!collapsed()) {
                <span class="truncate">{{ item.label }}</span>
              }
            </a>
          }
        </div>
      }
    </nav>

    <!-- Collapse toggle (desktop only) -->
    <div class="hidden border-t p-3 md:block">
      <button
        type="button"
        (click)="ui.toggleSidebar()"
        class="btn btn-ghost flex w-full items-center gap-3 rounded-[--radius-sm] px-2.5 py-2 text-sm text-muted hover:text-fg"
        [class.justify-center]="collapsed()"
      >
        <app-icon [name]="collapsed() ? 'panel-left' : 'panel-left-close'" [size]="18" />
        @if (!collapsed()) {
          <span>Collapse</span>
        }
      </button>
    </div>
  `,
  styles: `
    .active-nav {
      background-color: var(--accent-soft);
      color: var(--accent-soft-fg);
    }
    .active-nav::before {
      content: '';
      position: absolute;
      left: -0.75rem;
      top: 50%;
      height: 1.25rem;
      width: 3px;
      transform: translateY(-50%);
      border-radius: 0 3px 3px 0;
      background-color: var(--accent);
    }
  `,
})
export class SidebarComponent {
  protected readonly ui = inject(UiStateService);
  protected readonly sections = NAV_SECTIONS;
  protected readonly collapsed = this.ui.sidebarCollapsed;

  onNavigate(): void {
    this.ui.closeMobileSidebar();
  }
}
