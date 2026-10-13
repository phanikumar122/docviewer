import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { IconComponent } from './icon.component';
import { FileBadgeComponent } from './file-badge.component';
import { DropZoneComponent } from './drop-zone.component';
import { FilePickerService } from '../../core/services/file-picker.service';
import { LibraryService } from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { detectKind, type FileKind } from '../../core/models';
import { formatBytes, uid } from '../util/format';

export interface SourceItem {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  kind: FileKind;
  size: number;
}

/**
 * Reusable source selector for processing tools. Lets the user add files by
 * drag/drop, file browse, or picking from the library, and manages ordering.
 * Emits the current list of in-memory sources (never mutates the library).
 */
@Component({
  selector: 'app-pdf-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FileBadgeComponent, DropZoneComponent],
  template: `
    @if (items().length === 0 || multiple()) {
      <app-drop-zone
        [label]="label()"
        [accept]="accept()"
        [compact]="items().length > 0"
        [hint]="hint()"
        (filesDropped)="addFiles($event)"
      />
      <div class="mt-2 flex items-center justify-center gap-2 text-xs text-subtle">
        <span>or</span>
        <button type="button" class="font-medium text-accent hover:underline" (click)="addFromLibrary()">
          choose from your library
        </button>
      </div>
    }

    @if (items().length) {
      <ul class="mt-3 flex flex-col gap-2">
        @for (item of items(); track item.id; let i = $index; let first = $first; let last = $last) {
          <li class="flex items-center gap-3 rounded-[--radius-md] border bg-surface p-2.5">
            <span class="w-5 text-center text-xs font-medium text-subtle">{{ i + 1 }}</span>
            <app-file-badge [kind]="item.kind" [size]="34" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ item.name }}</div>
              <div class="text-xs text-subtle">{{ formatBytes(item.size) }}</div>
            </div>
            @if (multiple() && reorderable()) {
              <button type="button" class="btn-icon size-7" [disabled]="first" (click)="move(i, -1)" title="Move up">
                <app-icon name="chevron-up" [size]="15" />
              </button>
              <button type="button" class="btn-icon size-7" [disabled]="last" (click)="move(i, 1)" title="Move down">
                <app-icon name="chevron-down" [size]="15" />
              </button>
            }
            <button type="button" class="btn-icon size-7 text-subtle hover:text-danger" (click)="remove(item.id)" title="Remove">
              <app-icon name="x" [size]="15" />
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class PdfSourceComponent {
  readonly multiple = input(false);
  readonly reorderable = input(true);
  readonly kinds = input<FileKind[]>(['pdf']);
  readonly accept = input('application/pdf,.pdf');
  readonly label = input('Drag & drop a PDF here');
  readonly hint = input('or click to browse');
  readonly itemsChange = output<SourceItem[]>();

  private readonly picker = inject(FilePickerService);
  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);
  protected readonly formatBytes = formatBytes;

  protected readonly items = signal<SourceItem[]>([]);

  async addFiles(files: File[]): Promise<void> {
    const allowed = this.kinds();
    const next: SourceItem[] = [];
    for (const file of files) {
      const kind = detectKind(file.name, file.type);
      if (!allowed.includes(kind)) {
        this.toast.error('Unsupported file', `${file.name} is not a ${allowed.join('/')} file.`);
        continue;
      }
      next.push({ id: uid('src'), name: file.name, bytes: await file.arrayBuffer(), kind, size: file.size });
    }
    this.commit(this.multiple() ? [...this.items(), ...next] : next.slice(-1));
  }

  async addFromLibrary(): Promise<void> {
    const picked = await this.picker.pick({ kinds: this.kinds(), multiple: this.multiple() });
    const next: SourceItem[] = [];
    for (const doc of picked) {
      const bytes = await this.library.getArrayBuffer(doc.id);
      if (bytes) next.push({ id: uid('src'), name: doc.name, bytes, kind: doc.kind, size: doc.size });
    }
    if (next.length) this.commit(this.multiple() ? [...this.items(), ...next] : next.slice(-1));
  }

  remove(id: string): void {
    this.commit(this.items().filter((i) => i.id !== id));
  }

  move(index: number, delta: number): void {
    const list = [...this.items()];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.commit(list);
  }

  reset(): void {
    this.commit([]);
  }

  private commit(list: SourceItem[]): void {
    this.items.set(list);
    this.itemsChange.emit(list);
  }
}
