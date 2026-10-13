import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

type SplitMode = 'each' | 'ranges' | 'every';

@Component({
  selector: 'app-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Split PDF"
        subtitle="Break a PDF into separate files by page, custom ranges, or fixed chunks."
        icon="split"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Split PDF' }]"
      />

      <app-pdf-source (itemsChange)="onSource($event)" />

      @if (source(); as src) {
        <div class="card mt-5 p-4">
          <div class="mb-3 text-sm text-muted">
            <span class="font-medium text-fg">{{ src.name }}</span> · {{ pageCount() }} pages
          </div>

          <div class="flex flex-col gap-2">
            <label class="flex cursor-pointer items-start gap-3 rounded-[--radius-sm] p-2 hover:bg-surface-2">
              <input type="radio" name="mode" value="each" [checked]="mode() === 'each'" (change)="mode.set('each')" class="mt-1" />
              <span>
                <span class="text-sm font-medium">Split every page</span>
                <span class="block text-xs text-subtle">Creates {{ pageCount() }} single-page PDFs.</span>
              </span>
            </label>

            <label class="flex cursor-pointer items-start gap-3 rounded-[--radius-sm] p-2 hover:bg-surface-2">
              <input type="radio" name="mode" value="ranges" [checked]="mode() === 'ranges'" (change)="mode.set('ranges')" class="mt-1" />
              <span class="flex-1">
                <span class="text-sm font-medium">Custom ranges</span>
                <span class="block text-xs text-subtle">e.g. <code>1-3, 5, 8-10</code> — each range becomes one file.</span>
                @if (mode() === 'ranges') {
                  <input
                    type="text"
                    [value]="rangeText()"
                    (input)="rangeText.set($any($event.target).value)"
                    placeholder="1-3, 5, 8-10"
                    class="input mt-2 h-9"
                  />
                }
              </span>
            </label>

            <label class="flex cursor-pointer items-start gap-3 rounded-[--radius-sm] p-2 hover:bg-surface-2">
              <input type="radio" name="mode" value="every" [checked]="mode() === 'every'" (change)="mode.set('every')" class="mt-1" />
              <span class="flex-1">
                <span class="text-sm font-medium">Fixed chunks</span>
                <span class="block text-xs text-subtle">Split into files of N pages each.</span>
                @if (mode() === 'every') {
                  <input
                    type="number"
                    min="1"
                    [max]="pageCount()"
                    [value]="chunk()"
                    (input)="chunk.set(+$any($event.target).value)"
                    class="input mt-2 h-9 w-24"
                  />
                }
              </span>
            </label>
          </div>

          <button type="button" class="btn btn-primary btn-md mt-4" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="split" [size]="16" /> }
            Split PDF
          </button>
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class SplitComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly pageCount = signal(0);
  protected readonly mode = signal<SplitMode>('each');
  protected readonly rangeText = signal('');
  protected readonly chunk = signal(2);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async onSource(items: SourceItem[]): Promise<void> {
    const src = items[0] ?? null;
    this.source.set(src);
    this.output.set([]);
    if (src) {
      try {
        this.pageCount.set(await this.pdf.pageCount(src.bytes));
      } catch {
        this.toast.error('Could not read PDF', 'The file may be corrupt or password-protected.');
        this.source.set(null);
      }
    }
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    const total = this.pageCount();
    let ranges: { start: number; end: number }[] = [];
    try {
      if (this.mode() === 'each') {
        ranges = Array.from({ length: total }, (_, i) => ({ start: i + 1, end: i + 1 }));
      } else if (this.mode() === 'every') {
        const n = Math.max(1, this.chunk());
        for (let s = 1; s <= total; s += n) ranges.push({ start: s, end: Math.min(s + n - 1, total) });
      } else {
        ranges = this.parseRanges(this.rangeText(), total);
        if (!ranges.length) {
          this.toast.error('No valid ranges', 'Enter ranges like 1-3, 5, 8-10.');
          return;
        }
      }
    } catch (e) {
      this.toast.error('Invalid ranges', e instanceof Error ? e.message : '');
      return;
    }

    this.busy.set(true);
    this.output.set([]);
    try {
      const parts = await this.pdf.splitByRanges(src.bytes, ranges);
      const stem = baseName(src.name);
      this.output.set(
        parts.map((bytes, i) => ({
          name: `${stem}-${ranges[i].start === ranges[i].end ? 'p' + ranges[i].start : ranges[i].start + '-' + ranges[i].end}.pdf`,
          blob: this.pdf.toBlob(bytes),
          kindHint: 'split',
        })),
      );
      this.toast.success('Split complete', `${parts.length} files created`);
    } catch (e) {
      this.toast.error('Split failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }

  private parseRanges(text: string, total: number): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!m) throw new Error(`"${part}" is not a valid range`);
      const start = Math.max(1, parseInt(m[1], 10));
      const end = m[2] ? parseInt(m[2], 10) : start;
      if (start > total || end > total) throw new Error(`Range "${part}" exceeds ${total} pages`);
      out.push({ start: Math.min(start, end), end: Math.max(start, end) });
    }
    return out;
  }
}
