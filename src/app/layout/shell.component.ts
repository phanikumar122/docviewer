import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar/sidebar.component';
import { TopbarComponent } from './topbar/topbar.component';
import { ToastHostComponent } from './toast-host.component';
import { CommandPaletteComponent } from './command-palette/command-palette.component';
import { UploadProgressComponent } from './upload-progress.component';
import { ConfirmHostComponent } from './confirm-host.component';
import { FilePickerHostComponent } from './file-picker-host.component';
import { UiStateService } from '../core/services/ui-state.service';
import { LibraryService } from '../core/services/library.service';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    ToastHostComponent,
    CommandPaletteComponent,
    UploadProgressComponent,
    ConfirmHostComponent,
    FilePickerHostComponent,
  ],
  host: { class: 'flex h-dvh w-full overflow-hidden bg-bg text-fg' },
  template: `
    <!-- Desktop sidebar rail -->
    <aside
      class="hidden shrink-0 border-r md:block"
      [style.width.px]="ui.sidebarCollapsed() ? 72 : 256"
      style="transition: width .22s cubic-bezier(.4,0,.2,1)"
    >
      <app-sidebar />
    </aside>

    <!-- Mobile drawer -->
    @if (ui.mobileSidebarOpen()) {
      <div class="fixed inset-0 z-50 md:hidden">
        <div class="drawer-backdrop absolute inset-0 bg-black/50 backdrop-blur-sm" (click)="ui.closeMobileSidebar()"></div>
        <div class="drawer-panel absolute inset-y-0 left-0 w-64 border-r shadow-[var(--shadow-pop)]">
          <app-sidebar />
        </div>
      </div>
    }

    <!-- Main column -->
    <div class="flex min-w-0 flex-1 flex-col">
      <app-topbar />
      <main class="flex-1 overflow-y-auto">
        <router-outlet />
      </main>
    </div>

    @if (ui.commandPaletteOpen()) {
      <app-command-palette />
    }
    <app-upload-progress />
    <app-toast-host />
    <app-confirm-host />
    <app-file-picker-host />
  `,
  styles: `
    .drawer-backdrop {
      animation: fade-in 0.2s ease;
    }
    .drawer-panel {
      animation: slide-in 0.24s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @keyframes slide-in {
      from {
        transform: translateX(-100%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .drawer-backdrop,
      .drawer-panel {
        animation: none;
      }
    }
  `,
})
export class ShellComponent {
  protected readonly ui = inject(UiStateService);
  private readonly library = inject(LibraryService);

  constructor() {
    void this.library.init();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.ui.toggleCommandPalette();
    }
  }
}
