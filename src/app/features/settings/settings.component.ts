import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { IconComponent } from '../../shared/components/icon.component';
import { LibraryService } from '../../core/services/library.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import { formatBytes } from '../../shared/util/format';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header title="Settings" subtitle="Storage and data management." icon="settings" />

      <!-- Storage -->
      <section class="card mb-5 p-5">
        <h2 class="mb-1 font-semibold">Storage</h2>
        <p class="mb-4 text-sm text-muted">
          Your files are stored locally in this browser using IndexedDB. Nothing is uploaded to any server.
        </p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-[--radius-md] bg-surface-2 p-3">
            <div class="text-xl font-semibold">{{ library.liveFiles().length }}</div>
            <div class="text-xs text-subtle">Files</div>
          </div>
          <div class="rounded-[--radius-md] bg-surface-2 p-3">
            <div class="text-xl font-semibold">{{ library.folders().length }}</div>
            <div class="text-xs text-subtle">Folders</div>
          </div>
          <div class="rounded-[--radius-md] bg-surface-2 p-3">
            <div class="text-xl font-semibold">{{ formatBytes(library.totalSize()) }}</div>
            <div class="text-xs text-subtle">Content size</div>
          </div>
          <div class="rounded-[--radius-md] bg-surface-2 p-3">
            <div class="text-xl font-semibold">{{ usage() }}</div>
            <div class="text-xs text-subtle">Browser usage</div>
          </div>
        </div>
      </section>

      <!-- Data management -->
      <section class="card mb-5 p-5">
        <h2 class="mb-1 font-semibold">Data management</h2>
        <p class="mb-4 text-sm text-muted">Clean up activity, empty the trash, or wipe everything stored by DocuFlow.</p>
        <div class="flex flex-col divide-y divide-[color:var(--line)]">
          <div class="flex items-center justify-between gap-4 py-3">
            <div>
              <div class="text-sm font-medium">Clear activity history</div>
              <div class="text-xs text-subtle">Remove the recent-activity log.</div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" (click)="clearActivity()">Clear</button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div>
              <div class="text-sm font-medium">Empty trash</div>
              <div class="text-xs text-subtle">{{ library.trashedFiles().length }} item(s) in trash.</div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="library.trashedFiles().length === 0" (click)="emptyTrash()">
              Empty
            </button>
          </div>
          <div class="flex items-center justify-between gap-4 py-3">
            <div>
              <div class="text-sm font-medium text-danger">Delete all data</div>
              <div class="text-xs text-subtle">Permanently remove every file, folder and setting.</div>
            </div>
            <button type="button" class="btn btn-sm" style="background: var(--danger); color: #fff" (click)="wipe()">
              <app-icon name="trash" [size]="15" /> Delete all
            </button>
          </div>
        </div>
      </section>

      <!-- About -->
      <section class="card p-5">
        <h2 class="mb-1 font-semibold">About & limitations</h2>
        <ul class="mt-2 space-y-1.5 text-sm text-muted">
          <li class="flex gap-2"><app-icon name="check" [size]="16" class="mt-0.5 text-success" /> PDF viewing, merge/split/organize/rotate, watermark, page numbers, images↔PDF, PDF→text and image conversion run fully locally.</li>
          <li class="flex gap-2"><app-icon name="info" [size]="16" class="mt-0.5 text-info" /> High-fidelity Office conversions (DOCX/XLSX/PPTX ⇄ PDF) and PDF encryption require a server-side engine and are not faked.</li>
          <li class="flex gap-2"><app-icon name="shield" [size]="16" class="mt-0.5 text-muted" /> DocuFlow never sends your documents to a server. All processing happens in your browser.</li>
        </ul>
      </section>
    </div>
  `,
})
export class SettingsComponent {
  protected readonly library = inject(LibraryService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly formatBytes = formatBytes;

  protected readonly usage = signal('—');

  constructor() {
    void this.library.storageEstimate().then((est) => {
      if (est && est.usage) this.usage.set(formatBytes(est.usage));
    });
  }

  protected async clearActivity(): Promise<void> {
    await this.library.clearActivity();
    this.toast.success('Activity cleared');
  }

  protected async emptyTrash(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Empty trash?',
      message: 'This permanently deletes all items in the trash. This cannot be undone.',
      confirmText: 'Empty trash',
      danger: true,
    });
    if (ok) {
      await this.library.emptyTrash();
      this.toast.success('Trash emptied');
    }
  }

  protected async wipe(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Delete all data?',
      message: 'Every file, folder, editor document and setting stored by DocuFlow will be permanently removed.',
      confirmText: 'Delete everything',
      danger: true,
    });
    if (ok) {
      await this.library.clearAllData();
      this.toast.success('All data deleted', 'DocuFlow has been reset.');
    }
  }
}
