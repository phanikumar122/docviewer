import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import * as XLSX from 'xlsx';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

interface Sheet {
  name: string;
  rows: string[][];
}

const MAX_ROWS = 500;

@Component({
  selector: 'app-sheet-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, IconComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    <div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <app-page-header title="Edit Spreadsheet" subtitle="Open an Excel or CSV file, edit cells in the grid, and save it back — all in your browser."
        icon="table" [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Edit Spreadsheet' }]" />

      @if (!loaded()) {
        <app-pdf-source [kinds]="['spreadsheet', 'csv']" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          label="Drag & drop an .xlsx or .csv here" (itemsChange)="onSource($event)" />
      } @else {
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">{{ fileName() }}</span>
          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" class="btn btn-outline btn-sm" (click)="addRow()"><app-icon name="plus" [size]="14" /> Row</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="addCol()"><app-icon name="plus" [size]="14" /> Column</button>
            <button type="button" class="btn btn-primary btn-sm" (click)="exportXlsx()"><app-icon name="download" [size]="14" /> Save .xlsx</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="exportCsv()"><app-icon name="download" [size]="14" /> .csv</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="reset()">Change file</button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto rounded-[--radius-md] border bg-surface">
          @if (active(); as sheet) {
            <table class="border-collapse text-sm">
              <tbody>
                @for (row of sheet.rows; track ri; let ri = $index) {
                  <tr>
                    <td class="sticky left-0 z-10 w-10 border bg-surface-2 px-1 text-center text-[11px] text-subtle">{{ ri + 1 }}</td>
                    @for (cell of row; track ci; let ci = $index) {
                      <td class="border p-0">
                        <input class="h-7 w-28 bg-transparent px-2 text-sm outline-none focus:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]"
                          [value]="cell" (input)="setCell(ri, ci, $any($event.target).value)" />
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>

        @if (sheets().length > 1) {
          <div class="mt-2 flex items-center gap-1 overflow-x-auto">
            @for (s of sheets(); track s.name; let i = $index) {
              <button type="button" (click)="activeIndex.set(i)"
                class="whitespace-nowrap rounded-[--radius-xs] px-3 py-1 text-xs font-medium"
                [style.background]="activeIndex() === i ? 'var(--accent-soft)' : 'transparent'"
                [style.color]="activeIndex() === i ? 'var(--accent-soft-fg)' : 'var(--fg-muted)'">{{ s.name }}</button>
            }
          </div>
        }
        @if (truncated()) {
          <p class="mt-2 text-[11px] text-warning">Large sheet — showing the first {{ MAX_ROWS }} rows. Saving keeps only what's shown.</p>
        }
      }
    </div>
  `,
})
export class SheetEditorComponent {
  private readonly toast = inject(ToastService);
  protected readonly MAX_ROWS = MAX_ROWS;

  protected readonly sheets = signal<Sheet[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly fileName = signal('');
  protected readonly truncated = signal(false);
  protected readonly loaded = computed(() => this.sheets().length > 0);
  protected readonly active = computed(() => this.sheets()[this.activeIndex()] ?? null);

  protected async onSource(items: SourceItem[]): Promise<void> {
    const src = items[0];
    if (!src) return;
    try {
      const wb = XLSX.read(new Uint8Array(src.bytes), { type: 'array' });
      let trunc = false;
      const sheets: Sheet[] = wb.SheetNames.map((name) => {
        const raw = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        if (raw.length > MAX_ROWS) trunc = true;
        const rows = raw.slice(0, MAX_ROWS).map((r) => r.map((c) => (c == null ? '' : String(c))));
        const width = Math.max(1, ...rows.map((r) => r.length));
        rows.forEach((r) => { while (r.length < width) r.push(''); });
        return { name, rows: rows.length ? rows : [['']] };
      });
      this.sheets.set(sheets);
      this.activeIndex.set(0);
      this.fileName.set(src.name);
      this.truncated.set(trunc);
    } catch (e) {
      this.toast.error('Could not open', e instanceof Error ? e.message : 'Unsupported spreadsheet.');
    }
  }

  protected setCell(r: number, c: number, value: string): void {
    this.sheets.update((list) => list.map((s, i) => {
      if (i !== this.activeIndex()) return s;
      const rows = s.rows.map((row) => [...row]);
      rows[r][c] = value;
      return { ...s, rows };
    }));
  }

  protected addRow(): void {
    this.sheets.update((list) => list.map((s, i) => {
      if (i !== this.activeIndex()) return s;
      return { ...s, rows: [...s.rows, new Array(s.rows[0]?.length ?? 1).fill('')] };
    }));
  }

  protected addCol(): void {
    this.sheets.update((list) => list.map((s, i) => {
      if (i !== this.activeIndex()) return s;
      return { ...s, rows: s.rows.map((r) => [...r, '']) };
    }));
  }

  protected reset(): void {
    this.sheets.set([]);
    this.fileName.set('');
    this.truncated.set(false);
  }

  private buildWorkbook(): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    for (const s of this.sheets()) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31) || 'Sheet');
    }
    return wb;
  }

  protected exportXlsx(): void {
    const out = XLSX.write(this.buildWorkbook(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    this.download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${baseName(this.fileName())}-edited.xlsx`);
  }

  protected exportCsv(): void {
    const sheet = this.active();
    if (!sheet) return;
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(sheet.rows));
    this.download(new Blob([csv], { type: 'text/csv' }), `${baseName(this.fileName())}-${sheet.name}.csv`);
  }

  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast.success('Saved', name);
  }
}
