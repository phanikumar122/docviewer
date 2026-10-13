import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PageHeaderComponent, type Crumb } from '../../shared/components/page-header.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { FileBadgeComponent } from '../../shared/components/file-badge.component';
import { IconComponent } from '../../shared/components/icon.component';
import { FileDetailsComponent } from './file-details.component';
import { ContextMenuComponent, type MenuItem } from '../../shared/components/context-menu.component';
import { LibraryService } from '../../core/services/library.service';
import { UploadService } from '../../core/services/upload.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { FilePickerService } from '../../core/services/file-picker.service';
import { ToastService } from '../../core/services/toast.service';
import { kindMeta, type DocFile, type DocFolder, type FileKind, type SortKey } from '../../core/models';
import { formatBytes, relativeTime } from '../../shared/util/format';

type Mode = 'all' | 'recent' | 'starred' | 'trash';

@Component({
  selector: 'app-files',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    EmptyStateComponent,
    FileBadgeComponent,
    IconComponent,
    FileDetailsComponent,
    ContextMenuComponent,
  ],
  templateUrl: './files.component.html',
})
export class FilesComponent {
  // Route-bound inputs
  readonly mode = input<Mode>('all');
  readonly folderId = input<string | null>(null);

  private readonly library = inject(LibraryService);
  private readonly upload = inject(UploadService);
  private readonly confirm = inject(ConfirmService);
  private readonly picker = inject(FilePickerService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly kindMeta = kindMeta;
  protected readonly formatBytes = formatBytes;
  protected readonly relativeTime = relativeTime;

  // View state
  protected readonly view = signal<'grid' | 'list'>(this.readView());
  protected readonly query = signal('');
  protected readonly kindFilter = signal<FileKind | 'all'>('all');
  protected readonly sortKey = signal<SortKey>('updatedAt');
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly detailsId = signal<string | null>(null);

  // Context menu
  protected readonly menu = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);

  protected readonly loaded = this.library.loaded;

  protected readonly currentFolder = computed<DocFolder | null>(() =>
    this.folderId() ? this.library.folderById(this.folderId()!) ?? null : null,
  );

  protected readonly subFolders = computed<DocFolder[]>(() =>
    this.mode() === 'all' ? this.library.childFolders(this.folderId()) : [],
  );

  protected readonly files = computed<DocFile[]>(() => {
    let list: DocFile[];
    switch (this.mode()) {
      case 'recent':
        list = this.library.recentFiles();
        break;
      case 'starred':
        list = this.library.starredFiles();
        break;
      case 'trash':
        list = this.library.trashedFiles();
        break;
      default:
        list = this.library.filesInFolder(this.folderId());
    }
    const q = this.query().trim().toLowerCase();
    if (q) list = list.filter((f) => f.name.toLowerCase().includes(q));
    if (this.kindFilter() !== 'all') list = list.filter((f) => f.kind === this.kindFilter());
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (key === 'name') cmp = a.name.localeCompare(b.name);
      else if (key === 'kind') cmp = a.kind.localeCompare(b.kind);
      else if (key === 'size') cmp = a.size - b.size;
      else cmp = a.updatedAt - b.updatedAt;
      return cmp * dir;
    });
  });

  protected readonly detailsFile = computed(() =>
    this.detailsId() ? this.files().find((f) => f.id === this.detailsId()) ?? this.library.fileById(this.detailsId()!) ?? null : null,
  );

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly availableKinds = computed<FileKind[]>(() => {
    const kinds = new Set<FileKind>();
    const base =
      this.mode() === 'trash'
        ? this.library.trashedFiles()
        : this.mode() === 'starred'
          ? this.library.starredFiles()
          : this.mode() === 'recent'
            ? this.library.recentFiles()
            : this.library.filesInFolder(this.folderId());
    base.forEach((f) => kinds.add(f.kind));
    return [...kinds];
  });

  protected readonly crumbs = computed<Crumb[]>(() => {
    if (this.mode() !== 'all') return [];
    const path = this.library.folderPath(this.folderId());
    return [{ label: 'All Files', route: '/files' }, ...path.map((f) => ({ label: f.name, route: ['/files', f.id] }))];
  });

  protected readonly heading = computed(() => {
    switch (this.mode()) {
      case 'recent':
        return { title: 'Recent Files', subtitle: 'Documents you opened recently.', icon: 'clock' as const };
      case 'starred':
        return { title: 'Starred', subtitle: 'Your favourite documents.', icon: 'star' as const };
      case 'trash':
        return { title: 'Trash', subtitle: 'Deleted items can be restored or removed permanently.', icon: 'trash' as const };
      default:
        return {
          title: this.currentFolder()?.name ?? 'All Files',
          subtitle: 'Browse, organise and open your documents.',
          icon: 'files' as const,
        };
    }
  });

  // ---- selection ---------------------------------------------------------
  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggleSelect(id: string, event?: MouseEvent): void {
    event?.stopPropagation();
    const next = new Set(this.selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedIds.set(next);
  }

  protected selectAll(): void {
    this.selectedIds.set(new Set(this.files().map((f) => f.id)));
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  // ---- navigation / open -------------------------------------------------
  protected openFolder(folder: DocFolder): void {
    void this.router.navigate(['/files', folder.id]);
  }

  protected open(file: DocFile): void {
    if (this.mode() === 'trash') {
      this.detailsId.set(file.id);
      return;
    }
    void this.library.markOpened(file.id);
    const meta = kindMeta(file.kind);
    if (meta.hasViewer || file.kind === 'pdf') void this.router.navigate(['/viewer', file.id]);
    else if (meta.hasEditor) void this.router.navigate(['/editor', file.id]);
    else this.detailsId.set(file.id);
  }

  // ---- uploads -----------------------------------------------------------
  protected readonly dragOver = signal(false);

  protected onDragOver(e: DragEvent): void {
    if (this.mode() === 'trash') return;
    e.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
  }

  protected onContainerDrop(e: DragEvent): void {
    if (this.mode() === 'trash') return;
    e.preventDefault();
    this.dragOver.set(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) this.onFilesDropped(files);
  }

  protected onFilesDropped(files: File[]): void {
    void this.upload.importAll(files, this.mode() === 'all' ? this.folderId() : null);
  }

  protected uploadClick(): void {
    void this.upload.pickAndImport(this.mode() === 'all' ? this.folderId() : null);
  }

  // ---- view helpers ------------------------------------------------------
  protected setView(v: 'grid' | 'list'): void {
    this.view.set(v);
    try {
      localStorage.setItem('docuflow:view', v);
    } catch {
      /* ignore */
    }
  }

  protected setSort(key: SortKey): void {
    if (this.sortKey() === key) this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' ? 'asc' : 'desc');
    }
  }

  private readView(): 'grid' | 'list' {
    try {
      return localStorage.getItem('docuflow:view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  }

  // ---- actions -----------------------------------------------------------
  protected async newFolder(): Promise<void> {
    const name = prompt('Folder name', 'New folder');
    if (name) await this.library.createFolder(name, this.folderId());
  }

  protected async star(file: DocFile): Promise<void> {
    await this.library.toggleStar(file.id);
  }

  protected async rename(file: DocFile): Promise<void> {
    const name = prompt('Rename file', file.name);
    if (name && name !== file.name) await this.library.rename(file.id, name);
  }

  protected async duplicate(file: DocFile): Promise<void> {
    await this.library.duplicate(file.id);
    this.toast.success('Duplicated', file.name);
  }

  protected async moveSelected(): Promise<void> {
    const folders = this.library.folders();
    if (!folders.length) {
      this.toast.info('No folders yet', 'Create a folder first to move files into it.');
      return;
    }
    const ids = [...this.selectedIds()];
    const names = folders.map((f) => f.name).join(', ');
    const target = prompt(`Move ${ids.length} item(s) to which folder?\nAvailable: ${names}\n(leave blank for All Files)`, '');
    if (target === null) return;
    const dest = folders.find((f) => f.name.toLowerCase() === target.trim().toLowerCase());
    await this.library.move(ids, target.trim() ? dest?.id ?? null : null);
    this.clearSelection();
  }

  protected async trashFile(file: DocFile): Promise<void> {
    await this.library.trash([file.id]);
    if (this.detailsId() === file.id) this.detailsId.set(null);
  }

  protected async trashSelected(): Promise<void> {
    await this.library.trash([...this.selectedIds()]);
    this.clearSelection();
  }

  protected async restoreSelected(): Promise<void> {
    await this.library.restore([...this.selectedIds()]);
    this.clearSelection();
  }

  protected async deleteForeverSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    const ok = await this.confirm.ask({
      title: `Permanently delete ${ids.length} item(s)?`,
      message: 'This cannot be undone.',
      confirmText: 'Delete forever',
      danger: true,
    });
    if (ok) {
      await this.library.deleteForever(ids);
      this.clearSelection();
    }
  }

  // ---- context menu ------------------------------------------------------
  protected openMenu(event: MouseEvent, file: DocFile): void {
    event.preventDefault();
    event.stopPropagation();
    const items: MenuItem[] =
      this.mode() === 'trash'
        ? [
            { label: 'Restore', icon: 'archive-restore', action: () => void this.library.restore([file.id]) },
            {
              label: 'Delete forever',
              icon: 'trash',
              danger: true,
              action: async () => {
                const ok = await this.confirm.ask({ title: `Delete "${file.name}" forever?`, danger: true, confirmText: 'Delete' });
                if (ok) await this.library.deleteForever([file.id]);
              },
            },
          ]
        : [
            { label: 'Open', icon: 'external-link', action: () => this.open(file) },
            { label: 'Details', icon: 'info', action: () => this.detailsId.set(file.id) },
            { label: file.starred ? 'Unstar' : 'Star', icon: 'star', action: () => void this.star(file) },
            { label: 'Rename', icon: 'pencil', action: () => void this.rename(file) },
            { label: 'Duplicate', icon: 'copy', action: () => void this.duplicate(file) },
            { label: 'Move to trash', icon: 'trash', danger: true, action: () => void this.trashFile(file) },
          ];
    this.menu.set({ x: event.clientX, y: event.clientY, items });
  }

  protected closeMenu(): void {
    this.menu.set(null);
  }
}
