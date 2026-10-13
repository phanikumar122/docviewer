import { ChangeDetectionStrategy, Component, effect, signal, input, computed } from '@angular/core';
import * as XLSX from 'xlsx';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import type { DocFile } from '../../core/models';

interface SheetData {
  name: string;
  rows: string[][];
}

/**
 * Read-only spreadsheet preview using SheetJS. Shows each sheet's cells in a
 * grid with a tab bar. Formulas are shown as their computed values; this is a
 * viewer, not an editor.
 */
@Component({
  selector: 'app-sheet-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center gap-2 py-20 text-sm text-muted"><app-spinner [size]="18" /> Reading workbook…</div>
    } @else if (error()) {
      <div class="py-20 text-center text-sm text-danger">{{ error() }}</div>
    } @else {
      <div class="min-h-0 flex-1 overflow-auto">
        @if (active(); as sheet) {
          <table class="border-collapse text-sm">
            <tbody>
              @for (row of sheet.rows; track $index; let ri = $index) {
                <tr>
                  <td class="sticky left-0 z-10 border bg-surface-2 px-2 py-1 text-center text-xs text-subtle">{{ ri + 1 }}</td>
                  @for (cell of row; track $index) {
                    <td class="min-w-[6rem] max-w-xs truncate border px-2.5 py-1" [class.font-medium]="ri === 0">{{ cell }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      @if (sheets().length > 1) {
        <div class="flex items-center gap-1 overflow-x-auto border-t bg-surface px-2 py-1.5">
          @for (sheet of sheets(); track sheet.name; let i = $index) {
            <button
              type="button"
              (click)="activeIndex.set(i)"
              class="whitespace-nowrap rounded-[--radius-xs] px-3 py-1 text-xs font-medium transition-colors"
              [style.background]="activeIndex() === i ? 'var(--accent-soft)' : 'transparent'"
              [style.color]="activeIndex() === i ? 'var(--accent-soft-fg)' : 'var(--fg-muted)'"
            >
              {{ sheet.name }}
            </button>
          }
        </div>
      }
    }
  `,
})
export class SheetViewerComponent {
  readonly file = input.required<DocFile>();
  readonly blob = input.required<Blob>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly sheets = signal<SheetData[]>([]);
  protected readonly activeIndex = signal(0);
  protected readonly active = computed(() => this.sheets()[this.activeIndex()] ?? null);

  constructor() {
    effect(() => {
      const blob = this.blob();
      this.loading.set(true);
      this.error.set(null);
      blob
        .arrayBuffer()
        .then((buf) => {
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          const sheets: SheetData[] = wb.SheetNames.map((name) => {
            const ws = wb.Sheets[name];
            const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
            return { name, rows: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
          });
          this.sheets.set(sheets);
          this.activeIndex.set(0);
        })
        .catch((e: unknown) => {
          this.error.set(`Could not read this spreadsheet. (${e instanceof Error ? e.message : 'unknown error'})`);
        })
        .finally(() => this.loading.set(false));
    });
  }
}
