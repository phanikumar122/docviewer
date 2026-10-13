import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { FileBadgeComponent } from '../../shared/components/file-badge.component';
import { LibraryService } from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { kindMeta, type DocFile } from '../../core/models';
import { formatBytes, formatDateTime } from '../../shared/util/format';

/** Slide-over panel with a file's metadata, tags and quick actions. */
@Component({
  selector: 'app-file-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FileBadgeComponent],
  template: `
    <div class="fixed inset-0 z-[45] md:absolute" role="dialog" aria-modal="true">
      <div class="absolute inset-0 bg-black/40 md:bg-black/20" (click)="close.emit()"></div>
      <aside class="panel absolute inset-y-0 right-0 flex w-[min(90vw,22rem)] flex-col border-l bg-bg-elevated shadow-[var(--shadow-pop)]">
        <header class="flex items-center justify-between border-b px-4 py-3">
          <h2 class="font-semibold">Details</h2>
          <button type="button" class="btn-icon size-8" (click)="close.emit()" aria-label="Close"><app-icon name="x" [size]="18" /></button>
        </header>

        <div class="flex-1 overflow-y-auto p-4">
          <div class="mb-4 flex flex-col items-center text-center">
            @if (previewUrl()) {
              <img [src]="previewUrl()!" alt="" class="mb-3 max-h-40 rounded-[--radius-md] border object-contain" />
            } @else {
              <app-file-badge [kind]="file().kind" [size]="72" />
            }
            <h3 class="mt-3 break-words text-sm font-medium">{{ file().name }}</h3>
            <span class="chip mt-1 text-[11px]">{{ meta().label }}</span>
          </div>

          <dl class="space-y-2.5 text-sm">
            <div class="flex justify-between gap-3"><dt class="text-subtle">Size</dt><dd>{{ formatBytes(file().size) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-subtle">Type</dt><dd class="uppercase">{{ file().ext || '—' }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-subtle">Modified</dt><dd>{{ formatDateTime(file().updatedAt) }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-subtle">Created</dt><dd>{{ formatDateTime(file().createdAt) }}</dd></div>
            @if (file().lastOpenedAt) {
              <div class="flex justify-between gap-3"><dt class="text-subtle">Last opened</dt><dd>{{ formatDateTime(file().lastOpenedAt!) }}</dd></div>
            }
            @if (file().isDemo) {
              <div class="flex items-center gap-1.5 pt-1 text-xs text-subtle"><span class="size-1.5 rounded-full bg-accent"></span> Demo document</div>
            }
          </dl>

          <!-- Tags -->
          <div class="mt-5">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Tags</div>
            <div class="flex flex-wrap gap-1.5">
              @for (tag of file().tags; track tag) {
                <span class="chip gap-1 text-[11px]">
                  {{ tag }}
                  <button type="button" (click)="removeTag(tag)" class="text-subtle hover:text-danger"><app-icon name="x" [size]="12" /></button>
                </span>
              }
              <input
                type="text"
                [value]="tagInput()"
                (input)="tagInput.set($any($event.target).value)"
                (keydown.enter)="addTag()"
                placeholder="Add tag…"
                class="h-6 w-24 rounded-full bg-surface-2 px-2.5 text-[11px] outline-none placeholder:text-subtle"
              />
            </div>
          </div>
        </div>

        <footer class="grid grid-cols-2 gap-2 border-t p-3">
          <button type="button" class="btn btn-primary btn-md" (click)="openFile()"><app-icon name="external-link" [size]="15" /> Open</button>
          <button type="button" class="btn btn-outline btn-md" (click)="download()"><app-icon name="download" [size]="15" /> Download</button>
          <button type="button" class="btn btn-outline btn-md" (click)="star()">
            <app-icon name="star" [size]="15" /> {{ file().starred ? 'Unstar' : 'Star' }}
          </button>
          <button type="button" class="btn btn-outline btn-md text-danger" (click)="trash()"><app-icon name="trash" [size]="15" /> Trash</button>
        </footer>
      </aside>
    </div>
  `,
  styles: `
    .panel { animation: slide 0.24s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slide { from { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
  `,
})
export class FileDetailsComponent {
  readonly file = input.required<DocFile>();
  readonly close = output<void>();

  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly formatBytes = formatBytes;
  protected readonly formatDateTime = formatDateTime;

  protected readonly meta = () => kindMeta(this.file().kind);
  protected readonly tagInput = signal('');
  protected readonly previewUrl = signal<string | null>(null);
  private currentUrl: string | null = null;

  constructor() {
    effect((onCleanup) => {
      const f = this.file();
      this.revoke();
      if (f.kind === 'image') {
        void this.library.objectUrl(f.id).then((url) => {
          this.currentUrl = url;
          this.previewUrl.set(url);
        });
      } else {
        this.previewUrl.set(null);
      }
      onCleanup(() => this.revoke());
    });
  }

  private revoke(): void {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  protected openFile(): void {
    const f = this.file();
    void this.library.markOpened(f.id);
    const meta = kindMeta(f.kind);
    if (meta.hasViewer || f.kind === 'pdf') void this.router.navigate(['/viewer', f.id]);
    else if (meta.hasEditor) void this.router.navigate(['/editor', f.id]);
    else this.download();
    this.close.emit();
  }

  protected async download(): Promise<void> {
    const blob = await this.library.getBlob(this.file().id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.file().name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected star(): void {
    void this.library.toggleStar(this.file().id);
  }

  protected trash(): void {
    void this.library.trash([this.file().id]);
    this.close.emit();
  }

  protected addTag(): void {
    const tag = this.tagInput().trim();
    if (!tag) return;
    void this.library.setTags(this.file().id, [...this.file().tags, tag]);
    this.tagInput.set('');
  }

  protected removeTag(tag: string): void {
    void this.library.setTags(
      this.file().id,
      this.file().tags.filter((t) => t !== tag),
    );
  }
}
