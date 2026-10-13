import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from './icon.component';

export interface Crumb {
  label: string;
  route?: string | unknown[];
}

/** Page heading with optional breadcrumb trail and a projected actions area. */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="mb-6">
      @if (crumbs().length) {
        <nav class="mb-2 flex flex-wrap items-center gap-1 text-xs text-subtle">
          @for (crumb of crumbs(); track $index; let last = $last) {
            @if (crumb.route && !last) {
              <a [routerLink]="crumb.route" class="rounded px-1 py-0.5 transition-colors hover:text-fg">{{ crumb.label }}</a>
            } @else {
              <span class="px-1 py-0.5" [class.text-fg]="last">{{ crumb.label }}</span>
            }
            @if (!last) {
              <app-icon name="chevron-right" [size]="13" class="text-subtle/70" />
            }
          }
        </nav>
      }
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex items-center gap-3">
          @if (icon()) {
            <div
              class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] text-accent-soft-fg"
              style="background: var(--accent-soft)"
            >
              <app-icon [name]="icon()!" [size]="20" />
            </div>
          }
          <div>
            <h1 class="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{{ title() }}</h1>
            @if (subtitle()) {
              <p class="mt-0.5 text-sm text-muted">{{ subtitle() }}</p>
            }
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ng-content select="[actions]" />
        </div>
      </div>
    </div>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly icon = input<import('./icon.component').IconName | null>(null);
  readonly crumbs = input<Crumb[]>([]);
}
