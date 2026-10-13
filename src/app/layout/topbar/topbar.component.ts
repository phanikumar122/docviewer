import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { UiStateService } from '../../core/services/ui-state.service';
import { UploadService } from '../../core/services/upload.service';

@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class:
      'sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-bg/80 px-3 backdrop-blur-md sm:px-4',
  },
  template: `
    <!-- Mobile: open sidebar -->
    <button type="button" class="btn-icon size-9 md:hidden" (click)="ui.openMobileSidebar()" aria-label="Open menu">
      <app-icon name="menu" [size]="20" />
    </button>

    <!-- Global search (opens command palette) -->
    <button
      type="button"
      (click)="ui.openCommandPalette()"
      class="group flex h-9.5 min-w-0 flex-1 items-center gap-2.5 rounded-[--radius-sm] border border-line bg-surface-2 px-3 text-sm text-subtle transition-colors hover:border-line-strong sm:max-w-md"
    >
      <app-icon name="search" [size]="17" />
      <span class="truncate">Search files, tools, actions…</span>
      <kbd
        class="ml-auto hidden items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-subtle sm:flex"
      >
        {{ metaKey }}K
      </kbd>
    </button>

    <div class="ml-auto flex items-center gap-1.5">
      <!-- Create -->
      <button type="button" class="btn btn-outline btn-sm hidden gap-1.5 sm:inline-flex" (click)="create()">
        <app-icon name="plus" [size]="16" />
        <span>Create</span>
      </button>

      <!-- Upload -->
      <button type="button" class="btn btn-primary btn-sm gap-1.5" (click)="upload()">
        <app-icon name="upload" [size]="16" />
        <span class="hidden sm:inline">Upload</span>
      </button>
    </div>
  `,
})
export class TopbarComponent {
  protected readonly ui = inject(UiStateService);
  private readonly upload$ = inject(UploadService);
  private readonly router = inject(Router);

  protected readonly metaKey =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl ';

  protected upload(): void {
    void this.upload$.pickAndImport(null);
  }

  protected create(): void {
    void this.router.navigate(['/editor']);
  }
}
