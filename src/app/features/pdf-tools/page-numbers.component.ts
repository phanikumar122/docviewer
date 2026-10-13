import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService, type PageNumberOptions } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

@Component({
  selector: 'app-page-numbers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Add page numbers"
        subtitle="Stamp page numbers onto a PDF in the position and format you choose."
        icon="type"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Add page numbers' }]"
      />

      <app-pdf-source (itemsChange)="onSource($event)" />

      @if (source()) {
        <div class="card mt-5 grid gap-4 p-4 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-muted">Position</span>
            <select [value]="position()" (change)="position.set($any($event.target).value)" class="input h-9">
              <option value="bottom-center">Bottom center</option>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="top-center">Top center</option>
              <option value="top-right">Top right</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-muted">Format</span>
            <select [value]="format()" (change)="format.set($any($event.target).value)" class="input h-9">
              <option value="n">1, 2, 3…</option>
              <option value="n-of-total">1 / N</option>
              <option value="page-n">Page 1</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-muted">Start at</span>
            <input type="number" min="0" [value]="startAt()" (input)="startAt.set(+$any($event.target).value)" class="input h-9" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-muted">Font size: {{ fontSize() }}pt</span>
            <input type="range" min="8" max="24" [value]="fontSize()" (input)="fontSize.set(+$any($event.target).value)" class="w-full" />
          </label>
        </div>

        <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
          @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="type" [size]="16" /> }
          Add page numbers
        </button>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class PageNumbersComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly position = signal<PageNumberOptions['position']>('bottom-center');
  protected readonly format = signal<PageNumberOptions['format']>('n-of-total');
  protected readonly startAt = signal(1);
  protected readonly fontSize = signal(11);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    try {
      const bytes = await this.pdf.addPageNumbers(src.bytes, {
        position: this.position(),
        format: this.format(),
        startAt: this.startAt(),
        fontSize: this.fontSize(),
        margin: 32,
      });
      this.output.set([{ name: `${baseName(src.name)}-numbered.pdf`, blob: this.pdf.toBlob(bytes), kindHint: 'edit' }]);
      this.toast.success('Page numbers added');
    } catch (e) {
      this.toast.error('Failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}
