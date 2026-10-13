import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../../shared/components/icon.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { ToastService } from '../../core/services/toast.service';
import { PdfBackendService, type EngineFeatures } from '../../core/services/pdf-backend.service';

/**
 * Status + gate for engine-backed tools (protect, conversions). Probes the
 * local engine on init and renders a clear "it's not running" notice with a
 * copyable start command when it's offline — so these tools degrade gracefully
 * instead of silently failing. Host tools read `backend.status()` to disable
 * their action buttons.
 */
@Component({
  selector: 'app-engine-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent],
  template: `
    <div class="card mb-4 p-3">
      <div class="flex items-center gap-2 text-sm">
        <app-icon name="shield-check" [size]="16" class="text-accent-soft-fg" />
        <span class="font-medium">Local engine</span>
        @switch (status()) {
          @case ('up') {
            <span class="inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-px text-[11px] font-medium text-success">
              <span class="size-1.5 rounded-full bg-success"></span>running
            </span>
          }
          @case ('down') {
            <span class="inline-flex items-center gap-1 rounded-full bg-danger/15 px-1.5 py-px text-[11px] font-medium text-danger">
              <span class="size-1.5 rounded-full bg-danger"></span>offline
            </span>
          }
          @default { <span class="inline-flex items-center gap-1 text-[11px] text-subtle"><app-spinner [size]="11" /> checking…</span> }
        }
        <span class="ml-auto text-xs text-subtle">Runs on 127.0.0.1 · files never leave your device</span>
      </div>

      @if (status() === 'down') {
        <div class="mt-3 rounded-[--radius-sm] border border-danger/40 bg-danger/5 p-2.5 text-[12px] leading-snug text-muted">
          <p class="font-medium text-fg">The local engine isn't running.</p>
          <p class="mt-0.5">This tool runs in a small local service. Start it in a terminal, then re-check:</p>
          <code class="mt-1 block select-all rounded bg-bg px-1.5 py-1 text-[12px] text-fg">pnpm engine</code>
          <div class="mt-2 flex gap-1.5">
            <button type="button" class="btn btn-outline btn-sm" (click)="copy()"><app-icon name="copy" [size]="13" /> Copy</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="recheck()"><app-icon name="rotate-cw" [size]="13" /> Re-check</button>
          </div>
        </div>
      } @else if (status() === 'up' && feature() && features() && !features()![feature()!]) {
        <div class="mt-3 rounded-[--radius-sm] border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] p-2.5 text-[12px] text-warning">
          This engine build doesn't include this conversion. Reinstall the engine deps: <code class="select-all">cd server &amp;&amp; ./run.sh</code>
        </div>
      }
    </div>
  `,
})
export class EngineGateComponent {
  /** Optional feature key to warn about if the running engine lacks it. */
  readonly feature = input<keyof EngineFeatures | null>(null);

  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);

  protected readonly status = this.backend.status;
  protected readonly features = this.backend.features;
  protected readonly up = computed(() => this.status() === 'up');

  constructor() {
    void this.backend.health();
  }

  protected async recheck(): Promise<void> {
    const ok = await this.backend.health();
    if (ok) this.toast.success('Engine connected');
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText('pnpm engine');
      this.toast.success('Copied', 'pnpm engine');
    } catch {
      this.toast.info('Run this in a terminal', 'pnpm engine');
    }
  }
}
