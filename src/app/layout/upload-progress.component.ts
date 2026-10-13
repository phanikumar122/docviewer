import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../shared/components/icon.component';
import { UploadService } from '../core/services/upload.service';
import { formatBytes } from '../shared/util/format';

@Component({
  selector: 'app-upload-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (upload.active() && upload.items().length) {
      <div
        class="panel fixed bottom-4 left-4 z-[55] w-[min(90vw,20rem)] overflow-hidden rounded-[--radius-md] border border-line-strong bg-bg-elevated shadow-[var(--shadow-pop)]"
      >
        <div class="flex items-center gap-2 border-b px-3 py-2.5 text-sm font-medium">
          <app-icon name="cloud-upload" [size]="16" class="text-accent" />
          Uploading {{ upload.items().length }} file(s)
        </div>
        <div class="max-h-56 overflow-y-auto p-2">
          @for (item of upload.items(); track item.id) {
            <div class="px-1.5 py-1.5">
              <div class="flex items-center gap-2 text-xs">
                <app-icon
                  [name]="item.status === 'done' ? 'circle-check' : item.status === 'error' ? 'circle-x' : 'file'"
                  [size]="14"
                  [class]="item.status === 'done' ? 'text-success' : item.status === 'error' ? 'text-danger' : 'text-muted'"
                />
                <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
                <span class="text-subtle">{{ formatBytes(item.size) }}</span>
              </div>
              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  class="h-full rounded-full transition-[width] duration-200"
                  [style.width.%]="item.size ? (item.loaded / item.size) * 100 : 100"
                  [style.background]="item.status === 'error' ? 'var(--danger)' : 'var(--accent)'"
                ></div>
              </div>
              @if (item.error) {
                <div class="mt-1 text-[11px] text-danger">{{ item.error }}</div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .panel {
      animation: rise 0.24s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel {
        animation: none;
      }
    }
  `,
})
export class UploadProgressComponent {
  protected readonly upload = inject(UploadService);
  protected readonly formatBytes = formatBytes;
}
