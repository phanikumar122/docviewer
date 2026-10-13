import { Injectable, inject, signal } from '@angular/core';
import { LibraryService, type ImportProgress } from './library.service';
import { ToastService } from './toast.service';
import type { DocFile } from '../models';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: 'queued' | 'reading' | 'done' | 'error';
  error?: string;
}

/**
 * Coordinates importing browser Files into the library: opens the native file
 * picker, tracks per-file progress (exposed as a signal for progress UIs), and
 * surfaces success/error toasts.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);

  /** Live progress of the current/last batch, for progress indicators. */
  readonly items = signal<UploadItem[]>([]);
  readonly active = signal(false);

  /** Open the OS file picker and import the chosen files into `folderId`. */
  pickAndImport(folderId: string | null = null, accept = ''): Promise<DocFile[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (accept) input.accept = accept;
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const files = input.files ? Array.from(input.files) : [];
        input.remove();
        resolve(files.length ? await this.importAll(files, folderId) : []);
      });
      // If the dialog is cancelled there is no reliable event; resolve on focus return.
      const onFocus = () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) {
            input.remove();
            resolve([]);
          }
          window.removeEventListener('focus', onFocus);
        }, 400);
      };
      window.addEventListener('focus', onFocus);
      document.body.appendChild(input);
      input.click();
    });
  }

  /** Import an explicit list of files (e.g. from a drag-drop zone). */
  async importAll(files: File[], folderId: string | null = null): Promise<DocFile[]> {
    if (!files.length) return [];
    this.active.set(true);
    this.items.set(
      files.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        name: f.name,
        size: f.size,
        loaded: 0,
        status: 'queued' as const,
      })),
    );

    const results: DocFile[] = [];
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const doc = await this.library.importFile(file, folderId, (p: ImportProgress) => {
          this.updateItem(i, { loaded: p.loaded, status: p.status === 'error' ? 'error' : 'reading' });
        });
        this.updateItem(i, { loaded: file.size, status: 'done' });
        results.push(doc);
      } catch (e) {
        failed++;
        this.updateItem(i, { status: 'error', error: e instanceof Error ? e.message : 'Failed' });
      }
    }

    if (results.length) {
      this.toast.success(
        `Imported ${results.length} file${results.length > 1 ? 's' : ''}`,
        failed ? `${failed} file(s) failed` : undefined,
      );
    } else if (failed) {
      this.toast.error('Upload failed', this.items().find((i) => i.error)?.error);
    }

    // Clear the progress panel shortly after completion.
    setTimeout(() => {
      this.active.set(false);
      this.items.set([]);
    }, 1200);
    return results;
  }

  private updateItem(index: number, patch: Partial<UploadItem>): void {
    this.items.update((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
}
