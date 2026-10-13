import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { FilePickerService } from '../core/services/file-picker.service';
import { LibraryService } from '../core/services/library.service';
import { IconComponent } from '../shared/components/icon.component';
import { FileBadgeComponent } from '../shared/components/file-badge.component';
import { EmptyStateComponent } from '../shared/components/empty-state.component';
import { formatBytes, relativeTime } from '../shared/util/format';
import type { DocFile } from '../core/models';

@Component({
  selector: 'app-file-picker-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FileBadgeComponent, EmptyStateComponent],
  template: `
    @if (picker.request(); as req) {
      <div class="fixed inset-0 z-[75] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div class="fp-backdrop absolute inset-0 bg-black/55 backdrop-blur-sm" (click)="picker.cancel()"></div>
        <div class="fp-panel relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[--radius-lg] border border-line-strong bg-bg-elevated shadow-[var(--shadow-pop)]">
          <div class="flex items-center justify-between border-b px-4 py-3">
            <h2 class="font-semibold">{{ req.title }}</h2>
            <button type="button" class="btn-icon size-8" (click)="picker.cancel()" aria-label="Close">
              <app-icon name="x" [size]="18" />
            </button>
          </div>

          <div class="border-b px-4 py-2">
            <div class="flex items-center gap-2 rounded-[--radius-sm] bg-surface-2 px-2.5">
              <app-icon name="search" [size]="16" class="text-subtle" />
              <input
                type="text"
                [value]="query()"
                (input)="query.set($any($event.target).value)"
                placeholder="Filter files…"
                class="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
              />
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            @if (candidates().length === 0) {
              <app-empty-state icon="files" title="No matching files" message="Upload a file first, or adjust your filter." />
            }
            @for (file of candidates(); track file.id) {
              <button
                type="button"
                (click)="toggle(file)"
                class="flex w-full items-center gap-3 rounded-[--radius-sm] px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                [class.bg-surface-2]="isSelected(file)"
              >
                <app-file-badge [kind]="file.kind" [size]="34" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{{ file.name }}</div>
                  <div class="truncate text-xs text-subtle">{{ formatBytes(file.size) }} · {{ relativeTime(file.updatedAt) }}</div>
                </div>
                <span
                  class="grid size-5 place-items-center rounded-full border"
                  [class.border-line-strong]="!isSelected(file)"
                  [style.background]="isSelected(file) ? 'var(--accent)' : 'transparent'"
                  [style.border-color]="isSelected(file) ? 'var(--accent)' : null"
                >
                  @if (isSelected(file)) {
                    <app-icon name="check" [size]="13" class="text-white" />
                  }
                </span>
              </button>
            }
          </div>

          <div class="flex items-center justify-between gap-2 border-t px-4 py-3">
            <span class="text-xs text-subtle">{{ selected().length }} selected</span>
            <div class="flex gap-2">
              <button type="button" class="btn btn-outline btn-md" (click)="picker.cancel()">Cancel</button>
              <button type="button" class="btn btn-primary btn-md" [disabled]="selected().length === 0" (click)="confirm()">
                Use {{ selected().length || '' }} file{{ selected().length === 1 ? '' : 's' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .fp-backdrop { animation: fade 0.15s ease; }
    .fp-panel { animation: pop 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: scale(0.97); } }
    @media (prefers-reduced-motion: reduce) { .fp-backdrop, .fp-panel { animation: none; } }
  `,
})
export class FilePickerHostComponent {
  protected readonly picker = inject(FilePickerService);
  private readonly library = inject(LibraryService);
  protected readonly formatBytes = formatBytes;
  protected readonly relativeTime = relativeTime;

  protected readonly query = signal('');
  protected readonly selectedIds = signal<string[]>([]);

  protected readonly candidates = computed<DocFile[]>(() => {
    const req = this.picker.request();
    if (!req) return [];
    const q = this.query().trim().toLowerCase();
    return this.library
      .liveFiles()
      .filter((f) => !req.kinds || req.kinds.includes(f.kind))
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  protected readonly selected = computed(() =>
    this.candidates().filter((f) => this.selectedIds().includes(f.id)),
  );

  protected isSelected(file: DocFile): boolean {
    return this.selectedIds().includes(file.id);
  }

  protected toggle(file: DocFile): void {
    const req = this.picker.request();
    if (!req) return;
    if (!req.multiple) {
      this.selectedIds.set([file.id]);
      return;
    }
    this.selectedIds.update((ids) =>
      ids.includes(file.id) ? ids.filter((id) => id !== file.id) : [...ids, file.id],
    );
  }

  protected confirm(): void {
    this.picker.respond(this.selected());
    this.selectedIds.set([]);
    this.query.set('');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.picker.request()) this.picker.cancel();
  }
}
