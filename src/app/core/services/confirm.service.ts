import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ActiveConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** Promise-based confirmation dialog. The host component lives in the shell. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly active = signal<ActiveConfirm | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.active.set({ ...options, resolve });
    });
  }

  respond(ok: boolean): void {
    const current = this.active();
    if (current) {
      current.resolve(ok);
      this.active.set(null);
    }
  }
}
