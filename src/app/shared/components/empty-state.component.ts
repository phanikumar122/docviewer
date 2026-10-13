import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

/** Friendly empty / zero-data state with an icon, copy and projected actions. */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div class="empty-icon relative mb-4 grid size-16 place-items-center rounded-2xl border border-line bg-surface-2">
        <app-icon [name]="icon()" [size]="28" class="text-subtle" />
      </div>
      <h3 class="text-base font-semibold">{{ title() }}</h3>
      @if (message()) {
        <p class="mt-1 max-w-sm text-sm text-muted">{{ message() }}</p>
      }
      <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .empty-icon::after {
      content: '';
      position: absolute;
      inset: -6px;
      border-radius: 1.25rem;
      border: 1px dashed var(--line);
      opacity: 0.6;
    }
  `,
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('inbox');
  readonly title = input.required<string>();
  readonly message = input<string>('');
}
