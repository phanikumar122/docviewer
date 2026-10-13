import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IconComponent } from './icon.component';
import { FileBadgeComponent } from './file-badge.component';
import { LibraryService } from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { detectKind } from '../../core/models';
import { formatBytes } from '../util/format';

export interface ToolOutput {
  name: string;
  blob: Blob;
  /** Hint for library tagging / activity. */
  kindHint?: string;
}

/** Displays tool outputs with download / save-to-library / open actions. */
@Component({
  selector: 'app-tool-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FileBadgeComponent],
  host: { class: 'block' },
  template: `
    <div class="rounded-[--radius-lg] border border-success/40 bg-[color-mix(in_oklab,var(--success)_7%,var(--surface))] p-4">
      <div class="mb-3 flex items-center gap-2 text-sm font-medium text-success">
        <app-icon name="circle-check" [size]="18" />
        {{ outputs().length }} file{{ outputs().length === 1 ? '' : 's' }} ready
      </div>
      <div class="flex flex-col gap-2">
        @for (out of outputs(); track out.name; let i = $index) {
          <div class="flex items-center gap-3 rounded-[--radius-md] border bg-surface p-2.5">
            <app-file-badge [kind]="kindOf(out)" [size]="36" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{{ out.name }}</div>
              <div class="text-xs text-subtle">{{ formatBytes(out.blob.size) }}</div>
            </div>
            <div class="flex items-center gap-1">
              <button type="button" class="btn-icon size-8" title="Download" (click)="download(out)">
                <app-icon name="download" [size]="16" />
              </button>
              <button type="button" class="btn-icon size-8" title="Save to library" (click)="save(out)">
                <app-icon name="file-down" [size]="16" />
              </button>
            </div>
          </div>
        }
      </div>
      @if (outputs().length > 1) {
        <button type="button" class="btn btn-outline btn-sm mt-3" (click)="saveAll()">
          <app-icon name="file-down" [size]="15" />
          Save all to library
        </button>
      }
    </div>
  `,
})
export class ToolResultComponent {
  readonly outputs = input.required<ToolOutput[]>();

  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);
  protected readonly formatBytes = formatBytes;

  protected kindOf(out: ToolOutput) {
    return detectKind(out.name, out.blob.type);
  }

  protected download(out: ToolOutput): void {
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected async save(out: ToolOutput): Promise<void> {
    await this.library.saveOutput(out.blob, out.name, out.kindHint ?? 'tool');
    this.toast.success('Saved to library', out.name);
  }

  protected async saveAll(): Promise<void> {
    for (const out of this.outputs()) {
      await this.library.saveOutput(out.blob, out.name, out.kindHint ?? 'tool');
    }
    this.toast.success('Saved to library', `${this.outputs().length} files`);
  }
}
