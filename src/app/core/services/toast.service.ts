import { Injectable, signal } from '@angular/core';
import type { IconName } from '../../shared/components/icon.component';
import { uid } from '../../shared/util/format';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  icon?: IconName;
  /** ms before auto-dismiss; 0 = sticky (used for loading until resolved). */
  duration: number;
}

/** Lightweight global toast/notification store. Components read `toasts()`. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private push(t: Omit<Toast, 'id'>): string {
    const id = uid('toast');
    this.toasts.update((list) => [...list, { ...t, id }]);
    if (t.duration > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), t.duration),
      );
    }
    return id;
  }

  success(title: string, message?: string): string {
    return this.push({ kind: 'success', title, message, icon: 'circle-check', duration: 3500 });
  }

  error(title: string, message?: string): string {
    return this.push({ kind: 'error', title, message, icon: 'alert-circle', duration: 6000 });
  }

  info(title: string, message?: string): string {
    return this.push({ kind: 'info', title, message, icon: 'info', duration: 4000 });
  }

  /** Returns an id and an `update` handle to resolve the loading toast. */
  loading(title: string, message?: string): string {
    return this.push({ kind: 'loading', title, message, icon: 'spinner', duration: 0 });
  }

  resolve(id: string, kind: Exclude<ToastKind, 'loading'>, title: string, message?: string): void {
    const icon: IconName = kind === 'success' ? 'circle-check' : kind === 'error' ? 'alert-circle' : 'info';
    this.toasts.update((list) =>
      list.map((t) => (t.id === id ? { ...t, kind, title, message, icon, duration: 3500 } : t)),
    );
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), 3500),
    );
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
