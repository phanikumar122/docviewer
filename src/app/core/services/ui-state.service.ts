import { Injectable, signal } from '@angular/core';

/** Shared UI chrome state for the app shell (sidebar + command palette). */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  /** Desktop: sidebar collapsed to icon rail. Persisted. */
  readonly sidebarCollapsed = signal<boolean>(this.read('docuflow:sidebar', false));
  /** Mobile: sidebar drawer open. */
  readonly mobileSidebarOpen = signal(false);
  /** Command palette visibility. */
  readonly commandPaletteOpen = signal(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
    this.write('docuflow:sidebar', this.sidebarCollapsed());
  }

  openMobileSidebar(): void {
    this.mobileSidebarOpen.set(true);
  }
  closeMobileSidebar(): void {
    this.mobileSidebarOpen.set(false);
  }

  openCommandPalette(): void {
    this.commandPaletteOpen.set(true);
  }
  closeCommandPalette(): void {
    this.commandPaletteOpen.set(false);
  }
  toggleCommandPalette(): void {
    this.commandPaletteOpen.update((v) => !v);
  }

  private read(key: string, fallback: boolean): boolean {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v === 'true';
    } catch {
      return fallback;
    }
  }
  private write(key: string, value: boolean): void {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* ignore */
    }
  }
}
