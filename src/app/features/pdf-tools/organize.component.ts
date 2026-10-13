import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { PdfService } from '../../core/services/pdf.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName, uid } from '../../shared/util/format';

interface PageItem {
  id: string;
  /** 0-based index into the original document. */
  originalIndex: number;
  pageNumber: number;
  dataUrl: string;
}

@Component({
  selector: 'app-organize',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    PdfSourceComponent,
    ToolResultComponent,
    SpinnerComponent,
    IconComponent,
    CdkDropList,
    CdkDrag,
    CdkDropListGroup,
  ],
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <app-page-header
        title="Organize pages"
        subtitle="Drag to reorder, duplicate or delete pages, then export a new PDF."
        icon="grip"
        [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Organize pages' }]"
      />

      @if (!source()) {
        <app-pdf-source (itemsChange)="onSource($event)" />
      }

      @if (loading()) {
        <div class="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <app-spinner [size]="18" /> Rendering pages…
        </div>
      }

      @if (source() && !loading()) {
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted">{{ pages().length }} page(s) · drag to reorder</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="restore()">Reset</button>
          <button type="button" class="btn btn-primary btn-sm ml-auto" [disabled]="busy() || pages().length === 0" (click)="run()">
            @if (busy()) { <app-spinner [size]="15" /> } @else { <app-icon name="check" [size]="15" /> }
            Export PDF
          </button>
        </div>

        <div
          cdkDropListGroup
          cdkDropList
          cdkDropListOrientation="mixed"
          (cdkDropListDropped)="drop($event)"
          class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        >
          @for (page of pages(); track page.id) {
            <div cdkDrag class="group relative cursor-grab rounded-[--radius-md] border bg-surface p-2 active:cursor-grabbing">
              <div class="relative mb-2 grid aspect-[3/4] place-items-center overflow-hidden rounded bg-surface-2">
                <img [src]="page.dataUrl" [alt]="'Page ' + page.pageNumber" class="max-h-full max-w-full" loading="lazy" />
                <span class="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {{ page.pageNumber }}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <app-icon name="grip" [size]="15" class="text-subtle" />
                <div class="flex gap-0.5">
                  <button type="button" class="btn-icon size-7" (click)="duplicate(page)" title="Duplicate">
                    <app-icon name="copy" [size]="14" />
                  </button>
                  <button type="button" class="btn-icon size-7 hover:text-danger" (click)="remove(page.id)" title="Delete">
                    <app-icon name="trash" [size]="14" />
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (output().length) {
        <div class="mt-6"><app-tool-result [outputs]="output()" /></div>
      }
    </div>
  `,
})
export class OrganizeComponent {
  private readonly pdf = inject(PdfService);
  private readonly toast = inject(ToastService);

  protected readonly source = signal<SourceItem | null>(null);
  protected readonly pages = signal<PageItem[]>([]);
  private original: PageItem[] = [];
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected async onSource(items: SourceItem[]): Promise<void> {
    const src = items[0] ?? null;
    this.source.set(src);
    this.output.set([]);
    if (!src) return;
    this.loading.set(true);
    try {
      const rendered = await this.pdf.renderPages(src.bytes, 0.5);
      this.original = rendered.map((p) => ({
        id: uid('pg'),
        originalIndex: p.pageNumber - 1,
        pageNumber: p.pageNumber,
        dataUrl: p.dataUrl,
      }));
      this.pages.set([...this.original]);
    } catch {
      this.toast.error('Could not render PDF', 'The file may be corrupt or protected.');
      this.source.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected drop(event: CdkDragDrop<PageItem[]>): void {
    const list = [...this.pages()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.pages.set(list);
  }

  protected duplicate(page: PageItem): void {
    const list = [...this.pages()];
    const idx = list.findIndex((p) => p.id === page.id);
    list.splice(idx + 1, 0, { ...page, id: uid('pg') });
    this.pages.set(list);
  }

  protected remove(id: string): void {
    this.pages.set(this.pages().filter((p) => p.id !== id));
  }

  protected restore(): void {
    this.pages.set([...this.original]);
  }

  protected async run(): Promise<void> {
    const src = this.source();
    if (!src || this.pages().length === 0) return;
    this.busy.set(true);
    try {
      const order = this.pages().map((p) => p.originalIndex);
      const bytes = await this.pdf.selectPages(src.bytes, order);
      this.output.set([{ name: `${baseName(src.name)}-organized.pdf`, blob: this.pdf.toBlob(bytes), kindHint: 'organize' }]);
      this.toast.success('Export complete', `${order.length} pages`);
    } catch (e) {
      this.toast.error('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }
}
