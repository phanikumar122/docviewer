import { Injectable, computed, inject, signal } from '@angular/core';
import { DbService } from './db.service';
import type { ActivityEvent, ActivityType, DocFile, DocFolder } from '../models';
import { detectKind, extensionOf } from '../models';
import { uid, withSuffix } from '../../shared/util/format';
import { seedDemoData } from './demo-data';

/** Hard cap for a single imported file (keeps IndexedDB and memory sane). */
export const MAX_FILE_SIZE = 150 * 1024 * 1024;

export interface ImportProgress {
  file: File;
  loaded: number;
  total: number;
  status: 'reading' | 'done' | 'error';
  error?: string;
}

/**
 * Central document library. Owns the in-memory signal view of all files/folders
 * and keeps IndexedDB in sync. UI reads signals; mutations go through methods so
 * persistence and activity logging stay in one place.
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly db = inject(DbService);

  readonly files = signal<DocFile[]>([]);
  readonly folders = signal<DocFolder[]>([]);
  readonly activity = signal<ActivityEvent[]>([]);
  readonly loaded = signal(false);

  // Derived collections -----------------------------------------------------
  readonly liveFiles = computed(() => this.files().filter((f) => !f.trashed));
  readonly trashedFiles = computed(() => this.files().filter((f) => f.trashed));
  readonly starredFiles = computed(() => this.liveFiles().filter((f) => f.starred));
  readonly recentFiles = computed(() =>
    [...this.liveFiles()]
      .filter((f) => f.lastOpenedAt != null)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
  );
  readonly totalSize = computed(() => this.liveFiles().reduce((sum, f) => sum + f.size, 0));

  private initPromise: Promise<void> | null = null;

  /** Idempotent load from IndexedDB, seeding demo data on first run. */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.load();
    return this.initPromise;
  }

  private async load(): Promise<void> {
    let [files, folders] = await Promise.all([this.db.allFiles(), this.db.allFolders()]);
    if (files.length === 0 && folders.length === 0) {
      const seeded = await seedDemoData(this.db);
      files = seeded.files;
      folders = seeded.folders;
    }
    this.files.set(files);
    this.folders.set(folders);
    this.activity.set(await this.db.recentActivity());
    this.loaded.set(true);
  }

  // ---- queries -----------------------------------------------------------
  fileById(id: string): DocFile | undefined {
    return this.files().find((f) => f.id === id);
  }

  folderById(id: string): DocFolder | undefined {
    return this.folders().find((f) => f.id === id);
  }

  childFolders(parentId: string | null): DocFolder[] {
    return this.folders().filter((f) => f.parentId === parentId);
  }

  filesInFolder(folderId: string | null): DocFile[] {
    return this.liveFiles().filter((f) => f.folderId === folderId);
  }

  /** Resolve breadcrumb path from root to the given folder. */
  folderPath(folderId: string | null): DocFolder[] {
    const path: DocFolder[] = [];
    let current = folderId ? this.folderById(folderId) : undefined;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.folderById(current.parentId) : undefined;
    }
    return path;
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    return this.db.getBlob(id);
  }

  /** Read a file's bytes as an ArrayBuffer (for processing tools). */
  async getArrayBuffer(id: string): Promise<ArrayBuffer | undefined> {
    const blob = await this.db.getBlob(id);
    return blob ? blob.arrayBuffer() : undefined;
  }

  /** Create an object URL for a file blob. Caller is responsible for revoking it. */
  async objectUrl(id: string): Promise<string | null> {
    const blob = await this.db.getBlob(id);
    return blob ? URL.createObjectURL(blob) : null;
  }

  // ---- import ------------------------------------------------------------
  /**
   * Import a browser File into the library. Reads the bytes in chunks so the UI
   * can show real progress, validates size, then persists metadata + blob.
   */
  async importFile(
    file: File,
    folderId: string | null,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<DocFile> {
    if (file.size > MAX_FILE_SIZE) {
      const err = `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)}MB — exceeds the ${(
        MAX_FILE_SIZE /
        1024 /
        1024
      ).toFixed(0)}MB limit.`;
      onProgress?.({ file, loaded: 0, total: file.size, status: 'error', error: err });
      throw new Error(err);
    }

    const blob = await this.readWithProgress(file, onProgress);
    const now = Date.now();
    const ext = extensionOf(file.name);
    const doc: DocFile = {
      id: uid('file'),
      name: file.name,
      ext,
      mime: file.type || 'application/octet-stream',
      kind: detectKind(file.name, file.type),
      size: file.size,
      folderId,
      starred: false,
      trashed: false,
      trashedAt: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      isDemo: false,
    };
    await this.db.putBlob(doc.id, blob);
    await this.db.putFile(doc);
    this.files.update((list) => [doc, ...list]);
    await this.logActivity('upload', `Uploaded ${doc.name}`, doc);
    onProgress?.({ file, loaded: file.size, total: file.size, status: 'done' });
    return doc;
  }

  private readWithProgress(
    file: File,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      // The stored blob is a zero-copy slice of the File, so there is nothing to
      // actually read here — persistence happens in db.putBlob. For larger files
      // we still animate the progress bar in a few cheap steps, but we no longer
      // read (and immediately discard) every chunk just to drive it.
      if (file.size < 512 * 1024 || !onProgress) {
        onProgress?.({ file, loaded: file.size, total: file.size, status: 'reading' });
        resolve(file.slice());
        return;
      }
      const steps = 20;
      const stepSize = Math.ceil(file.size / steps);
      let loaded = 0;
      const tick = () => {
        loaded = Math.min(loaded + stepSize, file.size);
        onProgress({ file, loaded, total: file.size, status: 'reading' });
        if (loaded < file.size) {
          setTimeout(tick, 16);
        } else {
          resolve(file.slice());
        }
      };
      tick();
    });
  }

  /** Persist a tool-generated output (e.g. a merged PDF) as a new library file. */
  async saveOutput(
    blob: Blob,
    name: string,
    kindHint: string,
    folderId: string | null = null,
    activityType: ActivityType = 'tool',
    activityMessage?: string,
  ): Promise<DocFile> {
    const now = Date.now();
    const doc: DocFile = {
      id: uid('file'),
      name,
      ext: extensionOf(name),
      mime: blob.type || 'application/octet-stream',
      kind: detectKind(name, blob.type),
      size: blob.size,
      folderId,
      starred: false,
      trashed: false,
      trashedAt: null,
      tags: [kindHint].filter(Boolean),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      isDemo: false,
    };
    await this.db.putBlob(doc.id, blob);
    await this.db.putFile(doc);
    this.files.update((list) => [doc, ...list]);
    await this.logActivity(activityType, activityMessage ?? `Created ${doc.name}`, doc);
    return doc;
  }

  // ---- mutations ---------------------------------------------------------
  async rename(id: string, name: string): Promise<void> {
    const next = name.trim();
    if (!next) return;
    await this.patch(id, (f) => ({ ...f, name: next, ext: extensionOf(next), kind: detectKind(next, f.mime) }));
    await this.logActivity('rename', `Renamed to ${next}`, this.fileById(id));
  }

  async move(ids: string[], folderId: string | null): Promise<void> {
    for (const id of ids) await this.patch(id, (f) => ({ ...f, folderId }));
    const dest = folderId ? this.folderById(folderId)?.name ?? 'folder' : 'All Files';
    await this.logActivity('tool', `Moved ${ids.length} item(s) to ${dest}`);
  }

  async duplicate(id: string): Promise<DocFile | null> {
    const src = this.fileById(id);
    if (!src) return null;
    const blob = await this.db.getBlob(id);
    if (!blob) return null;
    const now = Date.now();
    const copy: DocFile = {
      ...src,
      id: uid('file'),
      name: withSuffix(src.name, ' copy'),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      starred: false,
      isDemo: false,
    };
    await this.db.putBlob(copy.id, blob);
    await this.db.putFile(copy);
    this.files.update((list) => [copy, ...list]);
    await this.logActivity('copy', `Duplicated ${src.name}`, copy);
    return copy;
  }

  async toggleStar(id: string): Promise<void> {
    await this.patch(id, (f) => ({ ...f, starred: !f.starred }));
    const f = this.fileById(id);
    if (f) await this.logActivity('star', `${f.starred ? 'Starred' : 'Unstarred'} ${f.name}`, f);
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    await this.patch(id, (f) => ({ ...f, tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))] }));
  }

  async trash(ids: string[]): Promise<void> {
    const now = Date.now();
    for (const id of ids) await this.patch(id, (f) => ({ ...f, trashed: true, trashedAt: now, starred: false }), false);
    await this.logActivity('delete', `Moved ${ids.length} item(s) to Trash`);
  }

  async restore(ids: string[]): Promise<void> {
    for (const id of ids) await this.patch(id, (f) => ({ ...f, trashed: false, trashedAt: null }), false);
    await this.logActivity('restore', `Restored ${ids.length} item(s) from Trash`);
  }

  async deleteForever(ids: string[]): Promise<void> {
    for (const id of ids) await this.db.deleteFile(id);
    this.files.update((list) => list.filter((f) => !ids.includes(f.id)));
    await this.logActivity('delete', `Permanently deleted ${ids.length} item(s)`);
  }

  async emptyTrash(): Promise<void> {
    const ids = this.trashedFiles().map((f) => f.id);
    await this.deleteForever(ids);
  }

  async markOpened(id: string): Promise<void> {
    const now = Date.now();
    await this.patch(id, (f) => ({ ...f, lastOpenedAt: now }), false);
    await this.logActivity('open', `Opened ${this.fileById(id)?.name ?? 'file'}`, this.fileById(id));
  }

  /** Replace the stored bytes of an existing file (used by the editor on save). */
  async updateContent(id: string, blob: Blob): Promise<void> {
    const current = this.fileById(id);
    if (!current) return;
    await this.db.putBlob(id, blob);
    await this.patch(id, (f) => ({ ...f, size: blob.size, mime: blob.type || f.mime }));
    await this.logActivity('edit', `Edited ${current.name}`, current);
  }

  /** Upsert the editor's autosave draft for a document (keyed by source file id). */
  async saveDraft(fileId: string, content: string, format: 'html' | 'markdown' | 'text' = 'html'): Promise<void> {
    await this.db.putEditorDoc({ id: `draft_${fileId}`, fileId, format, content, updatedAt: Date.now() });
  }

  async getDraft(fileId: string): Promise<{ content: string; updatedAt: number } | undefined> {
    const doc = await this.db.getEditorDoc(`draft_${fileId}`);
    return doc ? { content: doc.content, updatedAt: doc.updatedAt } : undefined;
  }

  // ---- folders -----------------------------------------------------------
  async createFolder(name: string, parentId: string | null): Promise<DocFolder> {
    const now = Date.now();
    const folder: DocFolder = { id: uid('folder'), name: name.trim() || 'Untitled folder', parentId, createdAt: now, updatedAt: now };
    await this.db.putFolder(folder);
    this.folders.update((list) => [...list, folder]);
    await this.logActivity('create', `Created folder "${folder.name}"`);
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const next = name.trim();
    if (!next) return;
    const folder = this.folderById(id);
    if (!folder) return;
    const updated = { ...folder, name: next, updatedAt: Date.now() };
    await this.db.putFolder(updated);
    this.folders.update((list) => list.map((f) => (f.id === id ? updated : f)));
  }

  /** Delete a folder; its files and subfolders are moved to Trash / root. */
  async deleteFolder(id: string): Promise<void> {
    const descendants = this.collectDescendantFolders(id);
    const folderIds = [id, ...descendants];
    const affectedFiles = this.files().filter((f) => f.folderId && folderIds.includes(f.folderId));
    const now = Date.now();
    // Trash the files AND detach them from the (about-to-be-deleted) folder, so
    // that restoring them later returns them to the root rather than stranding
    // them on a folder id that no longer exists in any view.
    for (const f of affectedFiles) {
      await this.patch(f.id, (x) => ({ ...x, folderId: null, trashed: true, trashedAt: now, starred: false }), false);
    }
    if (affectedFiles.length) {
      await this.logActivity('delete', `Moved ${affectedFiles.length} item(s) to Trash`);
    }
    for (const fid of folderIds) await this.db.deleteFolder(fid);
    this.folders.update((list) => list.filter((f) => !folderIds.includes(f.id)));
    await this.logActivity('delete', `Deleted folder "${this.folderById(id)?.name ?? ''}"`);
  }

  private collectDescendantFolders(id: string): string[] {
    const out: string[] = [];
    const walk = (parent: string) => {
      for (const child of this.folders().filter((f) => f.parentId === parent)) {
        out.push(child.id);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  }

  // ---- data management ---------------------------------------------------
  async clearAllData(): Promise<void> {
    await this.db.wipeAll();
    this.files.set([]);
    this.folders.set([]);
    this.activity.set([]);
  }

  async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    return this.db.estimateUsage();
  }

  async clearActivity(): Promise<void> {
    await this.db.clearActivity();
    this.activity.set([]);
  }

  // ---- internals ---------------------------------------------------------
  private async patch(id: string, fn: (f: DocFile) => DocFile, touch = true): Promise<void> {
    const current = this.fileById(id);
    if (!current) return;
    const updated = fn(current);
    if (touch) updated.updatedAt = Date.now();
    await this.db.putFile(updated);
    this.files.update((list) => list.map((f) => (f.id === id ? updated : f)));
  }

  private async logActivity(type: ActivityType, message: string, file?: DocFile): Promise<void> {
    const event: ActivityEvent = {
      id: uid('act'),
      type,
      fileId: file?.id,
      fileName: file?.name,
      message,
      at: Date.now(),
    };
    await this.db.addActivity(event);
    this.activity.update((list) => [event, ...list].slice(0, 60));
  }
}
