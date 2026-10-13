import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { IconComponent } from '../../shared/components/icon.component';
import { TOOLS } from '../pdf-tools/tools.catalog';

@Component({
  selector: 'app-converters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeaderComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Converters"
        subtitle="Convert between document and image formats. Processing location is noted on each converter."
        icon="arrow-right-left"
      />

      <div class="mb-6 flex items-start gap-3 rounded-[--radius-md] border border-info/30 bg-[color-mix(in_oklab,var(--info)_8%,var(--surface))] p-4">
        <app-icon name="info" [size]="18" class="mt-0.5 text-info" />
        <div class="text-sm text-muted">
          <p class="font-medium text-fg">Where does conversion happen?</p>
          <p class="mt-1">
            PDF ⇄ image and PDF → text run entirely in your browser.
            <strong>Word / Excel / PowerPoint ⇄ PDF</strong> run in the bundled local engine on
            <code>127.0.0.1</code> (start it with <code>pnpm engine</code>) — your files still never leave your
            device. These are faithful conversions; very complex Office layouts may differ slightly.
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (tool of convertTools; track tool.id) {
          @if (tool.implemented) {
            <a [routerLink]="tool.route" class="group card flex items-start gap-3 p-4 transition-all hover:-translate-y-0.5">
              <div class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] text-accent-soft-fg" style="background: var(--accent-soft)">
                <app-icon [name]="tool.icon" [size]="20" />
              </div>
              <div class="min-w-0">
                <div class="font-medium">{{ tool.title }}</div>
                <p class="mt-0.5 text-sm text-muted">{{ tool.description }}</p>
                <span class="chip mt-2 text-[10px] text-success">Runs locally</span>
              </div>
            </a>
          } @else {
            <div class="card flex items-start gap-3 p-4 opacity-70">
              <div class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] bg-surface-2 text-subtle">
                <app-icon [name]="tool.icon" [size]="20" />
              </div>
              <div class="min-w-0">
                <div class="font-medium">{{ tool.title }}</div>
                <p class="mt-0.5 text-sm text-muted">{{ tool.description }}</p>
                <span class="chip mt-2 text-[10px]">Needs backend engine</span>
              </div>
            </div>
          }
        }
        <a routerLink="/image-tools" class="group card flex items-start gap-3 p-4 transition-all hover:-translate-y-0.5">
          <div class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] text-accent-soft-fg" style="background: var(--accent-soft)">
            <app-icon name="image" [size]="20" />
          </div>
          <div class="min-w-0">
            <div class="font-medium">Image converter</div>
            <p class="mt-0.5 text-sm text-muted">Convert PNG, JPG and WEBP, resize and rotate images.</p>
            <span class="chip mt-2 text-[10px] text-success">Runs locally</span>
          </div>
        </a>
      </div>
    </div>
  `,
})
export class ConvertersComponent {
  protected readonly convertTools = TOOLS.filter((t) => t.category === 'convert');
}
