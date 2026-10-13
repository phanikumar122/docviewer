import { Injectable } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ActivityEvent, DocFile, DocFolder, EditorDoc } from '../models';

interface DocuFlowDB extends DBSchema {
  files: {
    key: string;
    value: DocFile;
    indexes: { byFolder: string; byUpdated: number };
  };
  folders: {
    key: string;
    value: DocFolder;
    indexes: { byParent: string };
  };
  blobs: {
    key: string;
    value: Blob;
  };
  activity: {
    key: string;
    value: ActivityEvent;
    indexes: { byAt: number };
  };
  editorDocs: {
    key: string;
    value: EditorDoc;
    indexes: { byFile: string };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'docuflow';
const DB_VERSION = 1;

/**
 * Thin, promise-based IndexedDB wrapper. All persistence (metadata, file blobs,
 * activity, editor autosaves, settings) flows through here so storage concerns
 * stay out of UI components. File *contents* live in the `blobs` store, never in
 * localStorage, keyed by the owning file id.
 */
@Injectable({ providedIn: 'root' })
export class DbService {
  private dbp: Promise<IDBPDatabase<DocuFlowDB>> | null = null;

  private db(): Promise<IDBPDatabase<DocuFlowDB>> {
    if (!this.dbp) {
      this.dbp = openDB<DocuFlowDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          const files = db.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('byFolder', 'folderId');
          files.createIndex('byUpdated', 'updatedAt');

          const folders = db.createObjectStore('folders', { keyPath: 'id' });
          folders.createIndex('byParent', 'parentId');

          db.createObjectStore('blobs');

          const activity = db.createObjectStore('activity', { keyPath: 'id' });
          activity.createIndex('byAt', 'at');

          const editorDocs = db.createObjectStore('editorDocs', { keyPath: 'id' });
          editorDocs.createIndex('byFile', 'fileId');

          db.createObjectStore('settings');
        },
      });
    }
    return this.dbp;
  }

  // ---- files -------------------------------------------------------------
  async allFiles(): Promise<DocFile[]> {
    return (await this.db()).getAll('files');
  }

  async putFile(file: DocFile): Promise<void> {
    await (await this.db()).put('files', file);
  }

  async putFiles(files: DocFile[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('files', 'readwrite');
    await Promise.all([...files.map((f) => tx.store.put(f)), tx.done]);
  }

  async getFile(id: string): Promise<DocFile | undefined> {
    return (await this.db()).get('files', id);
  }

  async deleteFile(id: string): Promise<void> {
    const db = await this.db();
    await Promise.all([
      db.delete('files', id),
      db.delete('blobs', id),
      this.deleteEditorDocByFile(id),
    ]);
  }

  // ---- blobs -------------------------------------------------------------
  async putBlob(id: string, blob: Blob): Promise<void> {
    await (await this.db()).put('blobs', blob, id);
  }

  async getBlob(id: string): Promise<Blob | undefined> {
    return (await this.db()).get('blobs', id);
  }

  // ---- folders -----------------------------------------------------------
  async allFolders(): Promise<DocFolder[]> {
    return (await this.db()).getAll('folders');
  }

  async putFolder(folder: DocFolder): Promise<void> {
    await (await this.db()).put('folders', folder);
  }

  async deleteFolder(id: string): Promise<void> {
    await (await this.db()).delete('folders', id);
  }

  // ---- activity ----------------------------------------------------------
  async recentActivity(limit = 40): Promise<ActivityEvent[]> {
    const db = await this.db();
    const all = await db.getAllFromIndex('activity', 'byAt');
    return all.reverse().slice(0, limit);
  }

  async addActivity(event: ActivityEvent): Promise<void> {
    const db = await this.db();
    await db.put('activity', event);
    // keep the log bounded
    const keys = await db.getAllKeysFromIndex('activity', 'byAt');
    if (keys.length > 200) {
      const tx = db.transaction('activity', 'readwrite');
      await Promise.all([...keys.slice(0, keys.length - 200).map((k) => tx.store.delete(k)), tx.done]);
    }
  }

  async clearActivity(): Promise<void> {
    await (await this.db()).clear('activity');
  }

  // ---- editor docs -------------------------------------------------------
  async getEditorDoc(id: string): Promise<EditorDoc | undefined> {
    return (await this.db()).get('editorDocs', id);
  }

  async getEditorDocByFile(fileId: string): Promise<EditorDoc | undefined> {
    const docs = await (await this.db()).getAllFromIndex('editorDocs', 'byFile', fileId);
    return docs[0];
  }

  async putEditorDoc(doc: EditorDoc): Promise<void> {
    await (await this.db()).put('editorDocs', doc);
  }

  async deleteEditorDocByFile(fileId: string): Promise<void> {
    const db = await this.db();
    const keys = await db.getAllKeysFromIndex('editorDocs', 'byFile', fileId);
    const tx = db.transaction('editorDocs', 'readwrite');
    await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
  }

  // ---- settings ----------------------------------------------------------
  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await this.db()).get('settings', key) as Promise<T | undefined>;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await (await this.db()).put('settings', value, key);
  }

  // ---- maintenance -------------------------------------------------------
  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
    return null;
  }

  async wipeAll(): Promise<void> {
    const db = await this.db();
    await Promise.all([
      db.clear('files'),
      db.clear('folders'),
      db.clear('blobs'),
      db.clear('activity'),
      db.clear('editorDocs'),
      db.clear('settings'),
    ]);
  }
}
