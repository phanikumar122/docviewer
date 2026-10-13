import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from './icon.component';
import { kindMeta } from '../../core/models';
import type { FileKind } from '../../core/models';

/** Colour-coded tile showing a file kind's icon. */
@Component({
  selector: 'app-file-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span
      class="grid shrink-0 place-items-center rounded-[--radius-sm]"
      [style.width.px]="box()"
      [style.height.px]="box()"
      [style.background]="'color-mix(in oklab, ' + meta().color + ' 16%, transparent)'"
      [style.color]="meta().color"
    >
      <app-icon [name]="meta().icon" [size]="icon()" />
    </span>
  `,
})
export class FileBadgeComponent {
  readonly kind = input.required<FileKind>();
  readonly size = input(40);

  protected readonly meta = computed(() => kindMeta(this.kind()));
  protected readonly box = computed(() => this.size());
  protected readonly icon = computed(() => Math.round(this.size() * 0.5));
}
