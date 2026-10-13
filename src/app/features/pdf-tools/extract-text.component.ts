import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

interface InspectInfo {
  pageCount: number;
  title?: string;
  author?: string;
  producer?: string;
  encrypted: boolean;
}

@Component({
  selector: 'app-extract-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header
        title="PDF to Text"
        subtitle="Extract the selectable text layer from a PDF and inspect its properties."
        icon="file-text"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'PDF to Text' }]"
      />

      @if (!source()) {
        <app-pdf-source (itemsChange)="onSource($event)" />
      }

      @if (source(); as src) {
        <div class="mb-4 flex items-center gap-3">
          <span class="text-sm text-muted"><span class="font-medium text-fg">{{ src.name }}</span></span>
          <button type="button" class="btn btn-primary btn-sm ml-auto" [disabled]="busy()" (click)="run()">
            @if (busy()) { <app-spinner [size]="15" /> } @else { <app-icon name="scan-text" [size]="15" /> }
            Extract text
          </button>
          <button type="button" class="btn btn-outline btn-sm" (click)="reset()">Change file</button>
        </div>
      }

      @if (info(); as meta) {
        <div class="card mb-4 p-4">
          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div class="text-xs text-subtle">Pages</div>
              <div class="font-medium">{{ meta.pageCount }}</div>
            </div>
            <div class="col-span-2">
              <div class="text-xs text-subtle">Title</div>
              <div class="truncate font-medium">{{ meta.title || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-subtle">Encrypted</div>
              <div class="font-medium">{{ meta.encrypted ? 'Yes' : 'No' }}</div>
            </div>
          </div>
          @if (meta.encrypted) {
            <div class="mt-3 flex items-start gap-2 rounded-[--radius-sm] border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] p-2.5 text-xs text-warning">
              <app-icon name="lock" [size]="15" class="mt-0.5" />
              This PDF reports permission restrictions. Extracted text is provided for content you are authorised to access.
            </div>
          }
        </div>
      }

      @if (combined() !== null) {
        @if (combined()!.trim().length === 0) {
          <div class="card p-4 text-sm text-muted">
            <div class="flex items-center gap-2 font-medium text-fg">
              <app-icon name="info" [size]="16" /> No selectable text found
            </div>
            <p class="mt-1">This may be a scanned PDF (images of text). OCR is available as a separate workflow.</p>
          </div>
        } @else {
          <div class="mb-3 flex items-center gap-2">
            <span class="text-sm font-medium">Preview</span>
            <button type="button" class="btn btn-outline btn-sm ml-auto" (click)="copy()">
              <app-icon name="copy" [size]="15" /> Copy text
            </button>
          </div>
          <pre class="max-h-80 overflow-auto whitespace-pre-wrap rounded-[--radius-md] border bg-surface-2 p-3 font-mono text-xs leading-relaxed">{{ combined() }}</pre>

          @if (output().length) {
            <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
          }
        }
      }
    </div>
  `,
})
export class ExtractTextComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly info = signal<InspectInfo | null>(null);
  protected readonly combined = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected onSource(items: SourceItem[]): void {
    this.source.set(items[0] ?? null);
    this.info.set(null);
    this.combined.set(null);
    this.output.set([]);
  }

  protected reset(): void {
    this.source.set(null);
    this.info.set(null);
    this.combined.set(null);
    this.output.set([]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src) return;
    this.busy.set(true);
    this.combined.set(null);
    this.output.set([]);
    try {
      const [meta, pages] = await Promise.all([this.pdf.inspect(src.bytes), this.pdf.extractText(src.bytes)]);
      this.info.set(meta);
      const text = pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join('\n\n');
      this.combined.set(text);
      if (text.trim().length > 0) {
        this.output.set([
          { name: `${baseName(src.name)}.txt`, blob: new Blob([text], { type: 'text/plain' }), kindHint: 'convert' },
        ]);
      }
      this.toast.success('Text extracted', `${pages.length} pages processed`);
    } catch (e) {
      this.toast.error('Extraction failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(): Promise<void> {
    const text = this.combined();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success('Copied to clipboard');
    } catch {
      this.toast.error('Could not copy', 'Clipboard access was denied.');
    }
  }
}
