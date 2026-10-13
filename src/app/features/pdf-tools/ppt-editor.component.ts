import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../shared/components/pdf-source.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IconComponent } from '../../shared/components/icon.component';
import { EngineGateComponent } from './engine-gate.component';
import { PdfBackendService, type PptxOutline } from '../../core/services/pdf-backend.service';
import { ToastService } from '../../core/services/toast.service';
import { baseName } from '../../shared/util/format';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

@Component({
  selector: 'app-ppt-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, SpinnerComponent, IconComponent, EngineGateComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <app-page-header title="Edit Presentation" subtitle="Open a PowerPoint (.pptx), edit slide text, reorder or delete slides, and save it back."
        icon="presentation" [crumbs]="[{ label: 'PDF Tools', route: '/tools' }, { label: 'Edit Presentation' }]" />

      <app-engine-gate feature="editPptx" />

      @if (!outline()) {
        <app-pdf-source [kinds]="['presentation']" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          label="Drag & drop a .pptx here" (itemsChange)="onSource($event)" />
        @if (busy()) { <div class="mt-3 flex items-center gap-2 text-sm text-muted"><app-spinner [size]="15" /> Reading slides…</div> }
      } @else {
        <div class="mb-3 flex items-center gap-2">
          <span class="text-sm font-medium">{{ fileName() }}</span>
          <span class="text-xs text-subtle">{{ visibleOrder().length }} slide(s)</span>
          <div class="ml-auto flex items-center gap-1.5">
            <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || engineStatus() !== 'up'" (click)="save()">
              @if (busy()) { <app-spinner [size]="14" /> } @else { <app-icon name="download" [size]="14" /> } Save .pptx
            </button>
            <button type="button" class="btn btn-outline btn-sm" (click)="reset()">Change file</button>
          </div>
        </div>

        @for (oi of visibleOrder(); track oi; let pos = $index) {
          <div class="card mb-3 p-4">
            <div class="mb-2 flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-subtle">Slide {{ pos + 1 }}</span>
              <div class="ml-auto flex items-center gap-1">
                <button type="button" class="btn-icon size-7 disabled:opacity-40" [disabled]="pos === 0" (click)="move(oi, -1)" title="Move up"><app-icon name="chevron-up" [size]="15" /></button>
                <button type="button" class="btn-icon size-7 disabled:opacity-40" [disabled]="pos === visibleOrder().length - 1" (click)="move(oi, 1)" title="Move down"><app-icon name="chevron-down" [size]="15" /></button>
                <button type="button" class="btn-icon size-7 text-subtle hover:text-danger" (click)="remove(oi)" title="Delete slide"><app-icon name="trash" [size]="15" /></button>
              </div>
            </div>
            @for (p of parasOf(oi); track p.id) {
              <input class="input mb-1.5 h-9" [value]="valueOf(p.id)" (input)="edit(p.id, $any($event.target).value)" [placeholder]="p.text ? '' : '(empty line)'" />
            }
            @if (!parasOf(oi).length) { <p class="text-xs text-subtle">No editable text on this slide.</p> }
          </div>
        }
        @if (!visibleOrder().length) {
          <p class="rounded-[--radius-md] border bg-surface-2 p-3 text-sm text-muted">All slides deleted. Add one back by changing the file, or save an empty deck.</p>
        }
      }
    </div>
  `,
})
export class PptEditorComponent {
  private readonly backend = inject(PdfBackendService);
  private readonly toast = inject(ToastService);

  private bytes: ArrayBuffer | null = null;
  protected readonly fileName = signal('');
  protected readonly outline = signal<PptxOutline | null>(null);
  protected readonly busy = signal(false);
  protected readonly engineStatus = this.backend.status;

  private readonly edits = signal<Record<string, string>>({});
  private readonly order = signal<number[]>([]);
  private readonly deleted = signal<Set<number>>(new Set());
  protected readonly visibleOrder = computed(() => this.order().filter((i) => !this.deleted().has(i)));

  protected async onSource(items: SourceItem[]): Promise<void> {
    const src = items[0];
    if (!src) return;
    this.bytes = src.bytes;
    this.fileName.set(src.name);
    this.busy.set(true);
    try {
      const o = await this.backend.pptxOutline(src.bytes);
      this.outline.set(o);
      this.order.set(o.slides.map((s) => s.index));
      this.edits.set({});
      this.deleted.set(new Set());
    } catch (e) {
      this.toast.error('Could not read presentation', e instanceof Error ? e.message : 'Is the engine running?');
    } finally {
      this.busy.set(false);
    }
  }

  protected parasOf(oi: number): { id: string; text: string }[] {
    return this.outline()?.slides.find((s) => s.index === oi)?.paras ?? [];
  }

  protected valueOf(id: string): string {
    const e = this.edits();
    if (id in e) return e[id];
    for (const s of this.outline()?.slides ?? []) {
      const p = s.paras.find((x) => x.id === id);
      if (p) return p.text;
    }
    return '';
  }

  protected edit(id: string, value: string): void {
    this.edits.update((e) => ({ ...e, [id]: value }));
  }

  protected move(oi: number, delta: number): void {
    const vis = this.visibleOrder();
    const pos = vis.indexOf(oi);
    const target = pos + delta;
    if (target < 0 || target >= vis.length) return;
    // Reorder within the full order array by swapping the two visible neighbours.
    const full = [...this.order()];
    const a = full.indexOf(vis[pos]);
    const b = full.indexOf(vis[target]);
    [full[a], full[b]] = [full[b], full[a]];
    this.order.set(full);
  }

  protected remove(oi: number): void {
    this.deleted.update((d) => new Set(d).add(oi));
  }

  protected reset(): void {
    this.bytes = null;
    this.outline.set(null);
    this.fileName.set('');
    this.edits.set({});
    this.order.set([]);
    this.deleted.set(new Set());
  }

  protected async save(): Promise<void> {
    if (!this.bytes) return;
    this.busy.set(true);
    try {
      const edits = Object.entries(this.edits()).map(([id, text]) => ({ id, text }));
      const out = await this.backend.pptxApply(this.bytes, {
        edits,
        delete: [...this.deleted()],
        order: this.order(),
      });
      const blob = new Blob([out.slice().buffer], { type: PPTX_MIME });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName(this.fileName())}-edited.pptx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast.success('Saved presentation', 'Downloaded your edited .pptx.');
    } catch (e) {
      this.toast.error('Save failed', e instanceof Error ? e.message : 'Engine error.');
    } finally {
      this.busy.set(false);
    }
  }
}
