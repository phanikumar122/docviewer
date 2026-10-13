import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { EngineGateComponent } from './engine-gate.component';
import { PdfBackendService } from '../../core/services/pdf-backend.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

@Component({
  selector: 'app-word-to-pdf',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent, EngineGateComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Word to PDF"
        subtitle="Convert Word documents (.docx, .doc) to PDF — typography, headings, tables, lists and images are preserved."
        icon="file-text"
        [crumbs]="[{ label: 'Converters', route: '/converters' }, { label: 'Word to PDF' }]"
      />

      <app-engine-gate feature="wordToPdf" />

      @if (!source()) {
        <app-pdf-source
          [kinds]="['word']"
          accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
          label="Drag & drop a Word (.docx / .doc) document here"
          (itemsChange)="onSource($event)"
        />
      }

      @if (source(); as src) {
        <div class="card mb-4 p-4">
          <div class="flex items-center gap-3">
            <app-icon name="file-type" [size]="20" class="text-accent-soft-fg" />
            <span class="min-w-0 truncate text-sm font-medium">{{ src.name }}</span>
            <button type="button" class="btn btn-outline btn-sm ml-auto" (click)="reset()">Change file</button>
          </div>
          <button type="button" class="btn btn-primary btn-md mt-4 w-full" [disabled]="busy() || engineStatus() !== 'up'" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="arrow-right-left" [size]="16" /> }
            Convert to PDF
          </button>
          <p class="mt-2 text-[11px] leading-relaxed text-subtle">
            High-fidelity typography and document layout (runs locally in the bundled engine, files never leave your device).
          </p>
        </div>
      }

      @if (output().length) {
        <app-tool-result [outputs]="output()" />
      }
    </div>
  `,
})
export class WordToPdfComponent {
  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);
  protected readonly engineStatus = this.backend.status;

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected reset(): void {
    this.source.set(null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const bytes = await this.backend.wordToPdf(src.bytes);
      const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
      this.output.set([{ name: `${baseName(src.name)}.pdf`, blob, kindHint: 'convert' }]);
      this.toast.success('Converted to PDF', 'Download your PDF below.');
    } catch (e) {
      this.toast.error('Conversion failed', e instanceof Error ? e.message : 'Could not reach the engine.');
    } finally {
      this.busy.set(false);
    }
  }
}
