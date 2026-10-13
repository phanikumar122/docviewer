import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent, type IconName } from '../../shared/components/icon.component';
import { EngineGateComponent } from './engine-gate.component';
import { PdfBackendService, type EngineFeatures } from '../../core/services/pdf-backend.service';
import { ToastService } from '../../core/services/toast.service';
import type { FileKind } from '../../core/models';
import { baseName } from '../../shared/util/format';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface ConvConfig {
  title: string;
  subtitle: string;
  icon: IconName;
  crumb: string;
  feature: keyof EngineFeatures;
  inputKinds: FileKind[];
  accept: string;
  inputLabel: string;
  outExt: string;
  outMime: string;
  cta: string;
  note?: string;
  run: (backend: PdfBackendService, bytes: ArrayBuffer) => Promise<{ bytes: Uint8Array; info?: string }>;
}

const CONFIGS: Record<string, ConvConfig> = {
  'excel-to-pdf': {
    title: 'Excel to PDF', subtitle: 'Convert an Excel (.xlsx) workbook to PDF — one section per sheet, with the grid preserved.',
    icon: 'table', crumb: 'Excel to PDF', feature: 'excelToPdf',
    inputKinds: ['spreadsheet'], accept: '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    inputLabel: 'Drag & drop a .xlsx here', outExt: 'pdf', outMime: 'application/pdf', cta: 'Convert to PDF',
    run: (b, bytes) => b.excelToPdf(bytes).then((bytes) => ({ bytes })),
  },
  'pdf-to-excel': {
    title: 'PDF to Excel', subtitle: 'Detect tables in a PDF and export them to an editable Excel (.xlsx) workbook.',
    icon: 'table', crumb: 'PDF to Excel', feature: 'pdfToExcel',
    inputKinds: ['pdf'], accept: 'application/pdf,.pdf', inputLabel: 'Drag & drop a PDF here',
    outExt: 'xlsx', outMime: XLSX_MIME, cta: 'Convert to Excel',
    note: 'Works best on PDFs with ruled tables. If none are found, the page text is exported instead.',
    run: (b, bytes) => b.pdfToExcel(bytes).then((r) => ({ bytes: r.bytes, info: r.tables ? `${r.tables} table${r.tables === 1 ? '' : 's'} extracted.` : 'No tables detected — exported the text instead.' })),
  },
  'ppt-to-pdf': {
    title: 'PowerPoint to PDF', subtitle: 'Convert PowerPoint (.pptx, .ppt) decks to PDF — slides, tables, shapes, text and images in place.',
    icon: 'presentation', crumb: 'PowerPoint to PDF', feature: 'pptToPdf',
    inputKinds: ['presentation'], accept: '.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint',
    inputLabel: 'Drag & drop a PowerPoint (.pptx / .ppt) deck here', outExt: 'pdf', outMime: 'application/pdf', cta: 'Convert to PDF',
    run: (b, bytes) => b.pptToPdf(bytes).then((bytes) => ({ bytes })),
  },
  'pdf-to-ppt': {
    title: 'PDF to PowerPoint', subtitle: 'Convert each PDF page into an editable PowerPoint (.pptx) slide — crisp graphics, layout and editable text.',
    icon: 'presentation', crumb: 'PDF to PowerPoint', feature: 'pdfToPpt',
    inputKinds: ['pdf'], accept: 'application/pdf,.pdf', inputLabel: 'Drag & drop a PDF here',
    outExt: 'pptx', outMime: PPTX_MIME, cta: 'Convert to PowerPoint',
    run: (b, bytes) => b.pdfToPpt(bytes).then((bytes) => ({ bytes })),
  },
  'ocr': {
    title: 'OCR scanned PDF', subtitle: 'Make a scanned PDF searchable — adds a selectable, copyable text layer over the page images.',
    icon: 'scan-text', crumb: 'OCR', feature: 'ocr',
    inputKinds: ['pdf'], accept: 'application/pdf,.pdf', inputLabel: 'Drag & drop a scanned PDF here',
    outExt: 'pdf', outMime: 'application/pdf', cta: 'Run OCR',
    note: 'Pages that already contain real text are kept as-is; only image/scanned pages are processed (English).',
    run: (b, bytes) => b.ocr(bytes).then((r) => ({ bytes: r.bytes, info: r.pages ? `${r.pages} page${r.pages === 1 ? '' : 's'} OCR'd and now searchable.` : 'All pages already had a text layer — nothing to OCR.' })),
  },
};

@Component({
  selector: 'app-office-convert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent, EngineGateComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header [title]="cfg.title" [subtitle]="cfg.subtitle" [icon]="cfg.icon"
        [crumbs]="[{ label: 'Converters', route: '/converters' }, { label: cfg.crumb }]" />

      <app-engine-gate [feature]="cfg.feature" />

      @if (!source()) {
        <app-pdf-source [kinds]="cfg.inputKinds" [accept]="cfg.accept" [label]="cfg.inputLabel" (itemsChange)="onSource($event)" />
      }

      @if (source(); as src) {
        <div class="card mb-4 p-4">
          <div class="flex items-center gap-3">
            <app-icon [name]="cfg.icon" [size]="20" class="text-accent-soft-fg" />
            <span class="min-w-0 truncate text-sm font-medium">{{ src.name }}</span>
            <button type="button" class="btn btn-outline btn-sm ml-auto" (click)="reset()">Change file</button>
          </div>
          <button type="button" class="btn btn-primary btn-md mt-4 w-full" [disabled]="busy() || engineStatus() !== 'up'" (click)="run()">
            @if (busy()) { <app-spinner [size]="16" /> } @else { <app-icon name="arrow-right-left" [size]="16" /> }
            {{ cfg.cta }}
          </button>
          @if (cfg.note) { <p class="mt-2 text-[11px] leading-relaxed text-subtle">{{ cfg.note }}</p> }
        </div>
      }

      @if (output().length) {
        <app-tool-result [outputs]="output()" />
      }
    </div>
  `,
})
export class OfficeConvertComponent {
  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly cfg = CONFIGS[this.route.snapshot.data['conv'] as string] ?? CONFIGS['excel-to-pdf'];
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
      const { bytes, info } = await this.cfg.run(this.backend, src.bytes);
      const blob = new Blob([bytes.slice().buffer], { type: this.cfg.outMime });
      this.output.set([{ name: `${baseName(src.name)}.${this.cfg.outExt}`, blob, kindHint: 'convert' }]);
      this.toast.success(`${this.cfg.title} complete`, info ?? 'Download your file below.');
    } catch (e) {
      this.toast.error('Conversion failed', e instanceof Error ? e.message : 'Could not reach the engine.');
    } finally {
      this.busy.set(false);
    }
  }
}
