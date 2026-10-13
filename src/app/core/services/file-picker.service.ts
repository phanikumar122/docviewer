import { Injectable, signal } from '@angular/core';
import type { DocFile, FileKind } from '../models';

export interface PickerRequest {
  title: string;
  kinds?: FileKind[];
  multiple: boolean;
  resolve: (files: DocFile[]) => void;
}

/** Opens a modal to choose existing files from the library. */
@Injectable({ providedIn: 'root' })
export class FilePickerService {
  readonly request = signal<PickerRequest | null>(null);

  pick(options: { title?: string; kinds?: FileKind[]; multiple?: boolean }): Promise<DocFile[]> {
    return new Promise((resolve) => {
      this.request.set({
        title: options.title ?? 'Select from library',
        kinds: options.kinds,
        multiple: options.multiple ?? false,
        resolve,
      });
    });
  }

  respond(files: DocFile[]): void {
    const req = this.request();
    if (req) {
      req.resolve(files);
      this.request.set(null);
    }
  }

  cancel(): void {
    this.respond([]);
  }
}
