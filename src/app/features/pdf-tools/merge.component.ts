import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-merge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Merge PDF"
        subtitle="Combine multiple PDFs into a single document, in the order you choose."
        icon="combine"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Merge PDF' }]"
      />

      <app-pdf-source [multiple]="true" (itemsChange)="sources.set($event)" />

      @if (sources().length >= 1) {
        <div class="mt-5 flex items-center gap-3">
          <button type="button" class="btn btn-primary btn-md" [disabled]="sources().length < 2 || busy()" (click)="run()">
            @if (busy()) {
              <app-spinner [size]="16" />
            } @else {
              <app-icon name="combine" [size]="16" />
            }
            Merge {{ sources().length }} PDFs
          </button>
          @if (sources().length < 2) {
            <span class="text-xs text-subtle">Add at least two PDFs to merge.</span>
          }
        </div>
      }

      @if (output().length) {
        <div class="mt-6">
          <app-tool-result [outputs]="output()" />
        </div>
      }
    </div>
  `,
})
export class MergeComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly sources = signal<SourceItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async run(): Promise<void> {
    if (this.sources().length < 2) return;
    this.busy.set(true);
    this.output.set([]);
    try {
      const bytes = await this.pdf.merge(this.sources().map((s) => s.bytes));
      this.output.set([{ name: 'merged.pdf', blob: this.pdf.toBlob(bytes), kindHint: 'merge' }]);
      this.toast.success('Merge complete', `${this.sources().length} files combined`);
    } catch (e) {
      this.toast.error('Merge failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}
