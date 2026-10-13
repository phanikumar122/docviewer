import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { IconComponent } from '../../shared/components/icon.component';
import { CATEGORY_LABELS, TOOLS, type ToolCategory, type ToolDef } from './tools.catalog';

@Component({
  selector: 'app-tools-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeaderComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <app-page-header
        title="PDF Tools"
        subtitle="Every tool runs locally in your browser. Tools needing a server engine are clearly marked."
        icon="wrench"
      />

      @for (group of groups; track group.category) {
        <section class="mb-8">
          <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">{{ group.label }}</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (tool of group.tools; track tool.id) {
              @if (tool.implemented) {
                <a [routerLink]="tool.route" class="tool-card group card flex items-start gap-3 p-4 transition-all hover:-translate-y-0.5">
                  <div class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] text-accent-soft-fg" style="background: var(--accent-soft)">
                    <app-icon [name]="tool.icon" [size]="20" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 font-medium">
                      {{ tool.title }}
                      <app-icon name="arrow-right" [size]="15" class="translate-x-0 text-subtle opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </div>
                    <p class="mt-0.5 text-sm text-muted">{{ tool.description }}</p>
                  </div>
                </a>
              } @else {
                <div class="card flex items-start gap-3 p-4 opacity-70" [title]="tool.note">
                  <div class="grid size-10 shrink-0 place-items-center rounded-[--radius-md] bg-surface-2 text-subtle">
                    <app-icon [name]="tool.icon" [size]="20" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 font-medium">
                      {{ tool.title }}
                      <span class="chip text-[10px]">Needs backend</span>
                    </div>
                    <p class="mt-0.5 text-sm text-muted">{{ tool.description }}</p>
                  </div>
                </div>
              }
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .tool-card:hover {
      border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
      box-shadow: var(--shadow-card);
    }
  `,
})
export class ToolsHomeComponent {
  protected readonly groups = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    tools: TOOLS.filter((t: ToolDef) => t.category === category),
  }));
}
