import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { getPdfjs } from '../../../core/pdf/pdfjs-loader';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PageHeaderComponent } from '../../../shared/components/page-header.component';
import { PdfSourceComponent, type SourceItem } from '../../../shared/components/pdf-source.component';
import { ToolResultComponent, type ToolOutput } from '../../../shared/components/tool-result.component';
import { SpinnerComponent } from '../../../shared/components/spinner.component';
import { IconComponent, type IconName } from '../../../shared/components/icon.component';
import { PdfService, type EditAnnotation } from '../../../core/services/pdf.service';
import { PdfBackendService } from '../../../core/services/pdf-backend.service';
import { LibraryService } from '../../../core/services/library.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { baseName, uid, withSuffix } from '../../../shared/util/format';
import {
  fontFamilyCss,
  hexToRgb01,
  isBoxLike,
  type Ann,
  type BoxAnn,
  type EditTool,
  type ImageAnn,
  type LineAnn,
  type PenAnn,
  type Pt,
  type TextAnn,
  type TextFont,
} from './edit-pdf.model';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface Style {
  color: string;
  opacity: number;
  strokeWidth: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  font?: TextFont;
}

interface Gesture {
  mode: 'create-box' | 'create-line' | 'pen' | 'move' | 'resize' | 'line-pt';
  id: string;
  start: Pt;
  corner?: Corner;
  which?: 1 | 2;
  orig?: Ann;
}

/**
 * One pdf.js text item resolved into display space (scale 1, top-left origin)
 * with a per-character box so a match can be covered glyph-accurately even when
 * it starts or ends partway through the run.
 */
interface TextRun {
  page: number;
  str: string;
  /** Per-character {left, width} in display points, index-aligned to `str`. */
  chars: { left: number; w: number }[];
  baseline: number;
  /** Top edge + height of the cover box for this run. */
  top: number;
  height: number;
  fontHeight: number;
  /** Right edge of the last glyph (for inter-run gap detection). */
  endX: number;
  /** False for rotated/mirrored/degenerate runs — matches touching them are skipped. */
  ok: boolean;
  /** Generic family + weight/style recovered from the source font, for an
   *  accurate restamp when this run is clicked to edit. */
  family: TextFont;
  bold: boolean;
  italic: boolean;
}

/** A matched character resolved back to its source run. */
interface MatchChar {
  run: number;
  ci: number;
}

@Component({
  selector: 'app-edit-pdf',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, PdfSourceComponent, ToolResultComponent, SpinnerComponent, IconComponent],
  templateUrl: './edit-pdf.component.html',
  styleUrl: './edit-pdf.component.css',
  host: {
    class: 'flex h-full min-h-0 flex-col',
    '(document:pointermove)': 'onPointerMove($event)',
    '(document:pointerup)': 'onPointerUp()',
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class EditPdfComponent {
  readonly id = input<string>();

  private readonly pdf = inject(PdfService);
  private readonly backend = inject(PdfBackendService);
  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly Math = Math;
  protected readonly fontFamilyCss = fontFamilyCss;

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stageRef = viewChild<ElementRef<HTMLDivElement>>('stage');

  // ---- document state ----
  protected readonly fileName = signal('');
  protected readonly ready = signal(false);
  protected readonly loading = signal(false);
  protected readonly numPages = signal(0);
  protected readonly page = signal(1);
  protected readonly scale = signal(1.3);
  protected readonly fitWidth = signal(true);
  private bytes: ArrayBuffer | null = null;
  private sourceDocId: string | null = null;
  private doc: PDFDocumentProxy | null = null;
  private loadingTask: ReturnType<ReturnType<typeof getPdfjs>['getDocument']> | null = null;
  private renderToken = 0;
  private renderTask: { cancel(): void; promise: Promise<void> } | null = null;
  /** Intrinsic page sizes in display points @scale 1, indexed by 0-based page. */
  private readonly pageSizes = signal<{ w: number; h: number }[]>([]);

  protected readonly pageW = computed(() => this.pageSizes()[this.page() - 1]?.w ?? 0);
  protected readonly pageH = computed(() => this.pageSizes()[this.page() - 1]?.h ?? 0);
  protected readonly cssW = computed(() => this.pageW() * this.scale());
  protected readonly cssH = computed(() => this.pageH() * this.scale());

  // ---- editing state ----
  protected readonly tool = signal<EditTool>('select');
  protected readonly anns = signal<Ann[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly editingId = signal<string | null>(null);

  protected readonly style = signal<Style>({
    color: '#e11d48',
    opacity: 0.4,
    strokeWidth: 2,
    fontSize: 16,
    bold: false,
    italic: false,
    font: 'sans',
  });

  private readonly past = signal<Ann[][]>([]);
  private readonly future = signal<Ann[][]>([]);
  protected readonly canUndo = computed(() => this.past().length > 0);
  protected readonly canRedo = computed(() => this.future().length > 0);

  // ---- find & replace state ----
  protected readonly showFindReplace = signal(false);
  protected readonly findText = signal('');
  protected readonly replaceText = signal('');
  protected readonly matchCase = signal(false);
  protected readonly coverColor = signal('#ffffff');
  protected readonly textColor = signal('#111827');
  protected readonly scanning = signal(false);
  protected readonly lastScan = signal<{ matches: number; pages: number; skipped: number } | null>(null);

  // Optional local engine (server/app.py) for TRUE in-place text replacement.
  protected readonly serverMode = signal(false);
  protected readonly serverBusy = signal(false);
  /** True once the user has flipped the engine toggle by hand — stops auto-detect
   *  from overriding their choice when another file is opened. */
  private serverModeTouched = false;
  /** True once the loaded bytes already contain a server-side edit. */
  protected readonly serverEdited = signal(false);
  protected readonly engineStatus = this.backend.status;
  protected readonly engineVersion = this.backend.engineVersion;
  protected readonly wholeWord = signal(false);

  // ---- paragraph reflow (engine) ----------------------------------------
  protected readonly reflowMode = signal(false);
  /** The paragraph picked for a rewrap: its box (display pts), text and style. */
  protected readonly reflowSel = signal<{
    page: number; rect: [number, number, number, number];
    text: string; fontSize: number; font: 'sans' | 'serif' | 'mono'; align: 'left' | 'center' | 'right';
    color: string; bold: boolean; italic: boolean;
  } | null>(null);

  protected readonly busy = signal(false);
  protected readonly output = signal<ToolOutput[]>([]);

  protected readonly pageAnns = computed(() => this.anns().filter((a) => a.page === this.page()));
  protected readonly selected = computed(() => this.anns().find((a) => a.id === this.selectedId()));
  /** What the properties panel edits: the selected element's kind, else the active tool. */
  protected readonly activeKind = computed<EditTool>(() => this.selected()?.type ?? this.tool());

  private gesture: Gesture | null = null;

  // ---- click-to-edit existing PDF text -----------------------------------
  /** Per-page text runs (positions + per-glyph boxes), built lazily on first
   *  click and reused. Cleared whenever a new document is loaded. */
  private readonly runCache = new Map<number, TextRun[]>();
  /** Reusable canvas 2d context for glyph width measurement. */
  private clickMeasurer: CanvasRenderingContext2D | null = null;
  /** Offscreen canvas for measuring reference bold/regular ink coverage. */
  private refCanvas: HTMLCanvasElement | null = null;
  /** text-ann id → the cover it sits on + the original text, so an untouched
   *  click (edit started, nothing changed) leaves the page exactly as it was. */
  private readonly clickEdits = new Map<string, { cover: string; original: string }>();

  constructor() {
    // Deep-link entry: /tools/edit/:id loads straight from the library.
    effect(() => {
      const id = this.id();
      if (id && !this.ready() && !this.loading()) void this.loadFromLibrary(id);
    });

    // Re-render the page whenever the page index or zoom changes.
    effect(() => {
      this.page();
      this.scale();
      if (this.doc) queueMicrotask(() => void this.renderPage());
    });

    this.destroyRef.onDestroy(() => void this.loadingTask?.destroy());
  }

  // ---- source loading ----------------------------------------------------
  protected onSource(items: SourceItem[]): void {
    const src = items[0];
    if (src) void this.load(src.bytes, src.name, null);
  }

  private async loadFromLibrary(id: string): Promise<void> {
    const file = this.library.fileById(id);
    const buf = await this.library.getArrayBuffer(id);
    if (!file || !buf) {
      this.toast.error('File not found', 'It may have been deleted or moved to Trash.');
      return;
    }
    await this.load(buf, file.name, id);
  }

  private async load(bytes: ArrayBuffer, name: string, docId: string | null): Promise<void> {
    this.loading.set(true);
    this.output.set([]);
    this.anns.set([]);
    this.past.set([]);
    this.future.set([]);
    this.selectedId.set(null);
    this.editingId.set(null);
    this.serverEdited.set(false);
    this.runCache.clear();
    this.clickEdits.clear();
    this.reflowSel.set(null);
    try {
      const pdfjs = getPdfjs();
      if (this.loadingTask) await this.loadingTask.destroy();
      // Keep a pristine copy of the bytes for export (pdf.js detaches its buffer).
      this.bytes = bytes.slice(0);
      this.loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
      this.doc = await this.loadingTask.promise;
      this.fileName.set(name);
      this.sourceDocId = docId;
      this.numPages.set(this.doc.numPages);
      this.pageSizes.set([]);
      this.page.set(1);
      this.ready.set(true);
      queueMicrotask(() => void this.initView());
      // Probe the local engine up front so the real in-place edit is the default
      // path when it's available — the user shouldn't have to hunt for a toggle.
      void this.detectEngine();
    } catch (e) {
      this.toast.error('Could not open PDF', e instanceof Error ? e.message : 'The file may be corrupt or protected.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Wait for the editor DOM to render after `ready` flips, then size & draw. */
  private initView(attempt = 0): void {
    if (!this.canvasRef() || !this.stageRef()) {
      if (attempt < 60) requestAnimationFrame(() => this.initView(attempt + 1));
      return;
    }
    void this.applyFitWidth().then(() => this.renderPage());
  }

  private async renderPage(): Promise<void> {
    const doc = this.doc;
    const canvas = this.canvasRef()?.nativeElement;
    if (!doc || !canvas) return;
    const token = ++this.renderToken;
    // Cancel any in-flight render — pdf.js forbids two renders on one canvas.
    if (this.renderTask) { try { this.renderTask.cancel(); } catch { /* already settled */ } this.renderTask = null; }
    const p = await doc.getPage(this.page());
    if (token !== this.renderToken) return;
    const base = p.getViewport({ scale: 1 });
    // Record the intrinsic (scale-1) size so the overlay geometry stays zoom-free.
    this.pageSizes.update((sizes) => {
      const next = [...sizes];
      next[this.page() - 1] = { w: base.width, h: base.height };
      return next;
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = p.getViewport({ scale: this.scale() });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = p.render({ canvas, viewport });
    this.renderTask = task;
    try {
      await task.promise;
    } catch {
      return; // cancelled or superseded
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
    if (token !== this.renderToken) return;
    p.cleanup();
  }

  // ---- navigation / zoom -------------------------------------------------
  protected go(delta: number): void {
    const next = Math.min(this.numPages(), Math.max(1, this.page() + delta));
    if (next === this.page()) return;
    this.stopEditing();
    this.selectedId.set(null);
    this.page.set(next);
    if (this.fitWidth()) queueMicrotask(() => void this.applyFitWidth());
  }

  protected onPageInput(value: string): void {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= this.numPages()) this.go(n - this.page());
  }

  protected zoom(delta: number): void {
    this.fitWidth.set(false);
    this.scale.set(Math.min(4, Math.max(0.3, +(this.scale() + delta).toFixed(2))));
  }

  protected toggleFit(): void {
    this.fitWidth.set(true);
    void this.applyFitWidth();
  }

  private async applyFitWidth(): Promise<void> {
    const doc = this.doc;
    const stageWrap = this.stageRef()?.nativeElement?.parentElement;
    if (!doc || !stageWrap) return;
    const p = await doc.getPage(this.page());
    const base = p.getViewport({ scale: 1 });
    p.cleanup();
    const avail = stageWrap.clientWidth - 48;
    this.scale.set(+Math.max(0.3, Math.min(4, avail / base.width)).toFixed(3));
  }

  // ---- tools & style -----------------------------------------------------
  protected setTool(t: EditTool): void {
    this.tool.set(t);
    this.stopEditing();
    if (t !== 'select') this.selectedId.set(null);
    const s = { ...this.style() };
    if (t === 'highlight') { s.color = '#fde047'; s.opacity = 0.4; }
    else if (t === 'whiteout') { s.color = '#ffffff'; s.opacity = 1; }
    else if (t === 'text') { s.color = '#111827'; }
    else if (t === 'rect' || t === 'line' || t === 'pen') { s.color = '#e11d48'; }
    this.style.set(s);
    if (t === 'image') this.pickImage();
  }

  protected readonly isCreateTool = computed(() => this.tool() !== 'select');

  protected readonly kindIcon = computed<IconName>(() => this.tools.find((t) => t.tool === this.activeKind())?.icon ?? 'arrow-up-down');
  protected readonly kindLabel = computed(() => this.tools.find((t) => t.tool === this.activeKind())?.label ?? 'Select');

  /** Apply a style change to the active defaults and to the selected element. */
  protected setStyle(patch: Partial<Style>): void {
    this.style.update((s) => ({ ...s, ...patch }));
    const sel = this.selected();
    if (!sel) return;
    this.snapshot();
    const s = this.style();
    if (sel.type === 'text') {
      this.updateAnn(sel.id, { color: s.color, fontSize: s.fontSize, bold: s.bold, italic: s.italic, font: s.font });
    } else if (sel.type === 'whiteout' || sel.type === 'highlight' || sel.type === 'rect') {
      this.updateAnn(sel.id, { color: s.color, opacity: s.opacity, strokeWidth: s.strokeWidth });
    } else if (sel.type === 'line' || sel.type === 'pen') {
      this.updateAnn(sel.id, { color: s.color, width: s.strokeWidth });
    }
  }

  protected onColor(v: string): void { this.setStyle({ color: v }); }
  protected onOpacity(v: number): void { this.setStyle({ opacity: v }); }
  protected onStrokeWidth(v: number): void { this.setStyle({ strokeWidth: v }); }
  protected onFontSize(v: number): void { this.setStyle({ fontSize: v }); }
  protected onFont(f: TextFont): void { this.setStyle({ font: f }); }
  protected toggleBold(): void { this.setStyle({ bold: !this.style().bold }); }
  protected toggleItalic(): void { this.setStyle({ italic: !this.style().italic }); }

  // ---- history -----------------------------------------------------------
  private snapshot(): void {
    this.past.update((p) => [...p.slice(-49), this.anns()]);
    this.future.set([]);
  }

  protected undo(): void {
    const past = this.past();
    if (!past.length) return;
    this.stopEditing();
    this.future.update((f) => [this.anns(), ...f]);
    this.anns.set(past[past.length - 1]);
    this.past.set(past.slice(0, -1));
    this.pruneSelection();
  }

  protected redo(): void {
    const future = this.future();
    if (!future.length) return;
    this.stopEditing();
    this.past.update((p) => [...p, this.anns()]);
    this.anns.set(future[0]);
    this.future.set(future.slice(1));
    this.pruneSelection();
  }

  private pruneSelection(): void {
    if (!this.anns().some((a) => a.id === this.selectedId())) this.selectedId.set(null);
  }

  // ---- annotation mutations ----------------------------------------------
  private addAnn(a: Ann): void {
    this.anns.update((list) => [...list, a]);
  }

  private updateAnn(id: string, patch: Record<string, unknown>): void {
    this.anns.update((list) => list.map((a) => (a.id === id ? ({ ...a, ...patch } as Ann) : a)));
  }

  protected deleteSelected(): void {
    const id = this.selectedId();
    if (!id) return;
    this.snapshot();
    this.anns.update((list) => list.filter((a) => a.id !== id));
    this.selectedId.set(null);
    this.stopEditing();
  }

  protected async clearPage(): Promise<void> {
    if (!this.pageAnns().length) return;
    const ok = await this.confirm.ask({
      title: `Clear page ${this.page()}?`,
      message: 'Remove all edits you have added to this page. This cannot be undone from here.',
      confirmText: 'Clear page',
      danger: true,
    });
    if (!ok) return;
    this.snapshot();
    const current = this.page();
    this.anns.update((list) => list.filter((a) => a.page !== current));
    this.selectedId.set(null);
    this.stopEditing();
  }

  protected selectAnn(a: Ann): void {
    this.selectedId.set(a.id);
    // Load the element's style into the active defaults so the panel reflects it.
    const s = { ...this.style() };
    if (a.type === 'text') { s.color = a.color; s.fontSize = a.fontSize; s.bold = a.bold; s.italic = a.italic; s.font = a.font ?? 'sans'; }
    else if (a.type === 'whiteout' || a.type === 'highlight' || a.type === 'rect') { s.color = a.color; s.opacity = a.opacity; s.strokeWidth = a.strokeWidth; }
    else if (a.type === 'line' || a.type === 'pen') { s.color = a.color; s.strokeWidth = a.width; }
    this.style.set(s);
  }

  // ---- pointer / gestures ------------------------------------------------
  private toLocal(ev: PointerEvent): Pt {
    const rect = this.stageRef()!.nativeElement.getBoundingClientRect();
    const s = this.scale();
    const x = (ev.clientX - rect.left) / s;
    const y = (ev.clientY - rect.top) / s;
    return { x: this.clamp(x, 0, this.pageW()), y: this.clamp(y, 0, this.pageH()) };
  }

  private clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  /** Pointer down on empty page area: create (tool mode) or, in select mode,
   *  click existing PDF text to edit it in place (else deselect). */
  protected onSurfacePointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    if (this.tool() === 'select') {
      this.selectedId.set(null);
      this.stopEditing();
      void this.editTextAt(ev);
      return;
    }
    this.startCreate(ev);
  }

  /**
   * Click-to-edit: find the PDF text run under the pointer and turn it into an
   * editable text box, pre-filled with the original text and sitting on an
   * opaque cover of the original glyphs — so the user clicks any text, gets a
   * caret right there, and types over it. On export the cover + new text are
   * burned in (and the original stays hidden beneath). Clicking a blank spot
   * just leaves the page deselected.
   */
  private async editTextAt(ev: PointerEvent): Promise<void> {
    if (!this.doc || !this.ready()) return;
    const page = this.page();
    const pt = this.toLocal(ev);
    let runs: TextRun[];
    try {
      runs = await this.runsForPage(page);
    } catch {
      return; // text layer unavailable (e.g. scanned page) — nothing to edit
    }
    if (page !== this.page()) return;
    // Reflow mode: select the whole paragraph under the pointer for a rewrap.
    if (this.reflowMode() && this.engineStatus() === 'up') {
      this.selectParagraph(runs, pt, page);
      return;
    }
    const run = this.runAt(runs, pt);
    if (!run) return;

    const x = run.chars[0].left;
    const w = Math.max(1, run.endX - x);
    const fs = Math.round(run.fontHeight * 10) / 10;
    const { fg, bg, bold, italic } = this.analyzeRun(run);
    // Name-based weight/style (when pdf.js exposes it) wins; pixel analysis fills
    // the gap for the many fonts that only report a generic family.
    const isBold = run.bold || bold;
    const isItalic = run.italic || italic;

    const cover: BoxAnn = {
      id: uid('a'), type: 'whiteout', page,
      x, y: run.top, w, h: run.height,
      color: bg, opacity: 1, strokeWidth: 0,
    };
    const text: TextAnn = {
      id: uid('a'), type: 'text', page,
      x, y: run.baseline - run.fontHeight * 0.9,
      w: w + 6, h: fs * 1.4,
      text: run.str, fontSize: fs, color: fg,
      bold: isBold, italic: isItalic, font: run.family,
    };
    this.snapshot();
    this.clickEdits.set(text.id, { cover: cover.id, original: run.str });
    this.anns.update((list) => [...list, cover, text]);
    this.selectedId.set(text.id);
    // Reflect the clicked run's style in the side controls.
    this.style.update((s) => ({ ...s, color: fg, fontSize: fs, bold: isBold, italic: isItalic, font: run.family }));
    // Snapshot already taken above, so startEditing(fresh) won't take another.
    queueMicrotask(() => this.startEditing(text.id, true));
  }

  /** Build (and cache) the current document's text runs for a page. */
  private async runsForPage(page: number): Promise<TextRun[]> {
    const cached = this.runCache.get(page);
    if (cached) return cached;
    if (!this.doc) return [];
    const p = await this.doc.getPage(page);
    const vp = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
    this.clickMeasurer ??= document.createElement('canvas').getContext('2d');
    const runs = this.buildRuns(page, content, vp, this.clickMeasurer);
    p.cleanup();
    this.runCache.set(page, runs);
    return runs;
  }

  /** The topmost non-rotated run whose box contains the point, if any. */
  private runAt(runs: TextRun[], pt: Pt): TextRun | null {
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      if (!run.ok || !run.chars.length) continue;
      const x0 = run.chars[0].left - 1;
      const x1 = run.endX + 1;
      if (pt.x >= x0 && pt.x <= x1 && pt.y >= run.top && pt.y <= run.top + run.height) return run;
    }
    return null;
  }

  /** Group a page's runs into paragraph blocks and select the one at `pt` for a
   *  server-side reflow (rewrap). Lines are grouped when they sit on consecutive
   *  baselines with a similar left edge. */
  private selectParagraph(runs: TextRun[], pt: Pt, page: number): void {
    const ok = runs.filter((r) => r.ok && r.chars.length).sort((a, b) => a.baseline - b.baseline || a.chars[0].left - b.chars[0].left);
    if (!ok.length) return;
    // Build line groups (runs sharing a baseline), then merge adjacent lines.
    const lines: TextRun[][] = [];
    for (const r of ok) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last[0].baseline - r.baseline) <= Math.max(last[0].fontHeight, r.fontHeight) * 0.5) last.push(r);
      else lines.push([r]);
    }
    const para: TextRun[][] = [];
    let group: TextRun[][] = [];
    const flush = () => {
      if (group.length) para.push(group.flat());
      group = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!group.length) { group.push(line); continue; }
      const prev = group[group.length - 1];
      const prevBase = prev[0].baseline, curBase = line[0].baseline;
      const lh = Math.max(prev[0].fontHeight, line[0].fontHeight);
      const prevLeft = Math.min(...prev.map((r) => r.chars[0].left));
      const curLeft = Math.min(...line.map((r) => r.chars[0].left));
      const gap = curBase - prevBase;
      if (gap > 0 && gap < lh * 2.1 && Math.abs(curLeft - prevLeft) < lh * 2.5) group.push(line);
      else { flush(); group.push(line); }
    }
    flush();
    // Find the paragraph whose bounding box contains the click.
    for (const block of para) {
      const flat = block;
      const x0 = Math.min(...flat.map((r) => r.chars[0].left));
      const x1 = Math.max(...flat.map((r) => r.endX));
      const y0 = Math.min(...flat.map((r) => r.top));
      const y1 = Math.max(...flat.map((r) => r.top + r.height));
      if (pt.x >= x0 - 2 && pt.x <= x1 + 2 && pt.y >= y0 - 2 && pt.y <= y1 + 2) {
        // Reassemble reading order: sort lines by baseline, runs by x, join.
        const byLine = new Map<number, TextRun[]>();
        for (const r of flat) {
          const key = Math.round(r.baseline);
          (byLine.get(key) ?? byLine.set(key, []).get(key)!).push(r);
        }
        const text = [...byLine.keys()].sort((a, b) => a - b)
          .map((k) => byLine.get(k)!.sort((a, b) => a.chars[0].left - b.chars[0].left).map((r) => r.str).join('')).join(' ');
        const fh = flat.map((r) => r.fontHeight).sort((a, b) => a - b)[Math.floor(flat.length / 2)];
        const famCount: Record<string, number> = {};
        for (const r of flat) famCount[r.family] = (famCount[r.family] ?? 0) + 1;
        const font = (Object.entries(famCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sans') as 'sans' | 'serif' | 'mono';
        const primary = flat[0];
        const analyzed = primary ? this.analyzeRun(primary) : { fg: '#111827', bold: false, italic: false };
        const isBold = flat.some((r) => r.bold) || analyzed.bold;
        const isItalic = flat.some((r) => r.italic) || analyzed.italic;
        const color = analyzed.fg || '#111827';
        this.reflowSel.set({
          page, rect: [x0, y0, x1 + 1, y1 + 1], text,
          fontSize: Math.round(fh * 10) / 10, font, align: 'left',
          color, bold: isBold, italic: isItalic,
        });
        this.selectedId.set(null);
        return;
      }
    }
  }

  protected toggleReflow(): void {
    const on = !this.reflowMode();
    this.reflowMode.set(on);
    this.reflowSel.set(null);
    if (on && this.engineStatus() !== 'up') void this.detectEngine();
  }

  protected updateReflowText(text: string): void {
    const sel = this.reflowSel();
    if (sel) this.reflowSel.set({ ...sel, text });
  }

  protected updateReflowSize(value: string): void {
    const sel = this.reflowSel();
    const n = parseFloat(value);
    if (sel && !Number.isNaN(n)) this.reflowSel.set({ ...sel, fontSize: Math.min(96, Math.max(5, n)) });
  }

  protected updateReflowFont(font: 'sans' | 'serif' | 'mono'): void {
    const sel = this.reflowSel();
    if (sel) this.reflowSel.set({ ...sel, font });
  }

  protected toggleReflowBold(): void {
    const sel = this.reflowSel();
    if (sel) this.reflowSel.set({ ...sel, bold: !sel.bold });
  }

  protected toggleReflowItalic(): void {
    const sel = this.reflowSel();
    if (sel) this.reflowSel.set({ ...sel, italic: !sel.italic });
  }

  protected updateReflowColor(color: string): void {
    const sel = this.reflowSel();
    if (sel) this.reflowSel.set({ ...sel, color });
  }

  protected cancelReflow(): void {
    this.reflowSel.set(null);
  }

  protected async applyReflow(): Promise<void> {
    const sel = this.reflowSel();
    if (!sel || !this.bytes || this.serverBusy()) return;
    this.serverBusy.set(true);
    try {
      const edited = await this.backend.reflow(this.bytes.slice(0), [{
        page: sel.page, rect: sel.rect, text: sel.text, fontSize: sel.fontSize, font: sel.font, align: sel.align,
        color: sel.color, bold: sel.bold, italic: sel.italic,
      }]);
      const buf = edited.slice().buffer;
      const name = this.fileName() || 'document.pdf';
      await this.load(buf, name, this.sourceDocId);
      this.serverEdited.set(true);
      this.reflowSel.set(null);
      this.output.set([{ name: withSuffix(name, '-reflowed'), blob: this.pdf.toBlob(edited), kindHint: 'edit' }]);
      this.toast.success('Paragraph reflowed', 'Rewrapped in place — true text edit. Download below or Save.');
    } catch (e) {
      this.toast.error('Reflow failed', e instanceof Error ? e.message : 'Could not reach the engine.');
    } finally {
      this.serverBusy.set(false);
    }
  }

  /**
   * Inspect the rendered pixels of a run to recover everything the source font
   * tells us visually: ink colour, local background colour, boldness and slant.
   * pdf.js only exposes a generic family (not weight/style) for most fonts, so
   * weight and italic are measured from the glyphs themselves:
   *  - bold: the run's ink coverage is compared to the same string rendered in
   *    the regular vs bold weight of its family; whichever it is closer to wins.
   *  - italic: the horizontal drift of the ink between the upper and lower bands
   *    of the line (slanted glyphs lean right going up).
   * Falls back to black-on-white / regular if the canvas can't be read.
   */
  private analyzeRun(run: TextRun): { fg: string; bg: string; bold: boolean; italic: boolean } {
    const fallback = { fg: '#111827', bg: '#ffffff', bold: false, italic: false };
    const canvas = this.canvasRef()?.nativeElement;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) return fallback;
    const f = this.scale() * Math.min(window.devicePixelRatio || 1, 2);
    const left = run.chars[0].left;
    const px = Math.max(0, Math.floor(left * f));
    const py = Math.max(0, Math.floor(run.top * f));
    const pw = Math.min(canvas.width - px, Math.max(1, Math.ceil((run.endX - left) * f)));
    const ph = Math.min(canvas.height - py, Math.max(1, Math.ceil(run.height * f)));
    if (pw < 2 || ph < 2) return fallback;
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(px, py, pw, ph).data;
    } catch {
      return fallback; // tainted / unreadable
    }

    // 1) Background colour: sample the 1px perimeter (top, bottom, left, right edges)
    // where text glyphs rarely touch. Falls back to modal colour across the box.
    let bgr = 255, bgg = 255, bgb = 255;
    const borderR: number[] = [], borderG: number[] = [], borderB: number[] = [];
    const pushBorder = (idx: number) => {
      borderR.push(data[idx]);
      borderG.push(data[idx + 1]);
      borderB.push(data[idx + 2]);
    };
    for (let x = 0; x < pw; x++) {
      pushBorder(x * 4); // top row
      pushBorder(((ph - 1) * pw + x) * 4); // bottom row
    }
    for (let y = 1; y < ph - 1; y++) {
      pushBorder((y * pw) * 4); // left col
      pushBorder((y * pw + (pw - 1)) * 4); // right col
    }
    if (borderR.length > 0) {
      // Find median / mode of border pixels
      bgr = Math.round(borderR.reduce((a, b) => a + b, 0) / borderR.length);
      bgg = Math.round(borderG.reduce((a, b) => a + b, 0) / borderG.length);
      bgb = Math.round(borderB.reduce((a, b) => a + b, 0) / borderB.length);
    } else {
      const counts = new Map<number, number>();
      const key = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      for (let i = 0; i < data.length; i += 4) {
        const k = key(data[i], data[i + 1], data[i + 2]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let bgKey = 0, bgMax = -1;
      for (const [k, c] of counts) if (c > bgMax) { bgMax = c; bgKey = k; }
      bgr = ((bgKey >> 8) & 15) * 17; bgg = ((bgKey >> 4) & 15) * 17; bgb = (bgKey & 15) * 17;
    }

    // 2) Foreground ink mask & peak contrast core:
    // Any pixel with noticeable distance from background is candidate ink.
    const n = pw * ph;
    const mask = new Uint8Array(n);
    let inkCount = 0, maxDist = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dist = (data[i] - bgr) ** 2 + (data[i + 1] - bgg) ** 2 + (data[i + 2] - bgb) ** 2;
      if (dist > 625) { mask[p] = 1; inkCount++; if (dist > maxDist) maxDist = dist; }
    }

    // 3) True foreground color from the solid core (highest contrast 25% of ink):
    // Stroke centers have pure, un-antialiased color. A histogram of exact colors
    // in the stroke core isolates the true font color perfectly.
    const coreT = maxDist * 0.72;
    const colorHist = new Map<number, { r: number; g: number; b: number; count: number }>();
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (!mask[p]) continue;
      const dist = (data[i] - bgr) ** 2 + (data[i + 1] - bgg) ** 2 + (data[i + 2] - bgb) ** 2;
      if (dist >= coreT) {
        // Quantize slightly (by 4 levels) to merge minor sensor/compression noise
        const rNorm = data[i] & 0xfc, gNorm = data[i + 1] & 0xfc, bNorm = data[i + 2] & 0xfc;
        const cKey = (rNorm << 16) | (gNorm << 8) | bNorm;
        const entry = colorHist.get(cKey) ?? { r: data[i], g: data[i + 1], b: data[i + 2], count: 0 };
        entry.count++;
        colorHist.set(cKey, entry);
      }
    }

    let topColor = { r: 17, g: 24, b: 39 }, maxColorCount = -1;
    for (const entry of colorHist.values()) {
      if (entry.count > maxColorCount) {
        maxColorCount = entry.count;
        topColor = entry;
      }
    }
    const bg = this.rgbHex(bgr, bgg, bgb);
    const fgHex = maxColorCount > 0 ? this.rgbHex(topColor.r, topColor.g, topColor.b) : fallback.fg;

    const letters = run.str.replace(/\s+/g, '').length;
    const famCss = run.family === 'serif' ? 'serif' : run.family === 'mono' ? 'monospace' : 'sans-serif';
    const fontPx = run.fontHeight * f;

    // 4) Boldness from stroke thickness:
    const strokeRatio = this.strokeOf(mask, pw, ph, inkCount, fontPx);
    let bold = run.bold;
    if (!bold && letters >= 1 && inkCount > 10) {
      const refReg = this.refStroke(run.str, famCss, '400', fontPx, ph);
      const refBold = this.refStroke(run.str, famCss, '700', fontPx, ph);
      if (refReg > 0 && refBold - refReg > 0.003) bold = strokeRatio >= (refReg + refBold) * 0.48;
    }

    // 5) Italic slant detection from pixel drift between upper and lower bands:
    let italic = run.italic;
    if (!italic && inkCount >= 15 && ph >= 6) {
      let topXSum = 0, topN = 0;
      let botXSum = 0, botN = 0;
      const quarterY = ph * 0.32;
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const p = y * pw + x;
          if (!mask[p]) continue;
          if (y < quarterY) { topXSum += x; topN++; }
          else if (y > ph - quarterY) { botXSum += x; botN++; }
        }
      }
      if (topN >= 4 && botN >= 4) {
        const drift = (topXSum / topN) - (botXSum / botN);
        const slantRatio = drift / (fontPx || ph);
        if (slantRatio >= 0.10) italic = true;
      }
    }

    return { fg: fgHex, bg, bold, italic };
  }

  /** Mean stroke width ÷ font size for an ink mask (2·area/boundary ≈ width). */
  private strokeOf(mask: Uint8Array, pw: number, ph: number, ink: number, fontPx: number): number {
    if (ink <= 0 || fontPx <= 0) return 0;
    let edges = 0;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        if (!mask[p]) continue;
        if (x === 0 || y === 0 || x === pw - 1 || y === ph - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - pw] || !mask[p + pw]) edges++;
      }
    }
    return edges > 0 ? (2 * ink / edges) / fontPx : 0;
  }

  /** Stroke ratio of a reference string in a given family/weight, rendered at
   *  the same size and measured identically — the baseline to judge boldness. */
  private refStroke(str: string, famCss: string, weight: string, fontPx: number, ph: number): number {
    this.refCanvas ??= document.createElement('canvas');
    const octx = this.refCanvas.getContext('2d', { willReadFrequently: true });
    if (!octx || fontPx < 1) return 0;
    octx.font = `${weight} ${fontPx}px ${famCss}`;
    const w = Math.max(1, Math.min(4096, Math.ceil(octx.measureText(str).width)));
    const h = Math.max(1, Math.ceil(ph));
    this.refCanvas.width = w;
    this.refCanvas.height = h;
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, w, h);
    octx.fillStyle = '#000';
    octx.textBaseline = 'alphabetic';
    octx.font = `${weight} ${fontPx}px ${famCss}`;
    octx.fillText(str, 0, 0.82 * fontPx);
    const d = octx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    let ink = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (d[i] < 232) { mask[p] = 1; ink++; } // same contrast cut as the actual run
    }
    return this.strokeOf(mask, w, h, ink, fontPx);
  }

  private rgbHex(r: number, g: number, b: number): string {
    const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  private startCreate(ev: PointerEvent): void {
    ev.preventDefault();
    const p = this.toLocal(ev);
    const s = this.style();
    const page = this.page();
    const tool = this.tool();
    this.snapshot();
    if (tool === 'text') {
      const ann: TextAnn = {
        id: uid('a'), type: 'text', page, x: p.x, y: p.y, w: 220, h: s.fontSize * 1.6,
        text: '', fontSize: s.fontSize, color: s.color, bold: s.bold, italic: s.italic, font: s.font,
      };
      this.addAnn(ann);
      this.selectedId.set(ann.id);
      this.tool.set('select');
      queueMicrotask(() => this.startEditing(ann.id));
      return;
    }
    if (tool === 'line') {
      const ann: LineAnn = { id: uid('a'), type: 'line', page, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: s.color, width: s.strokeWidth };
      this.addAnn(ann);
      this.selectedId.set(ann.id);
      this.gesture = { mode: 'create-line', id: ann.id, start: p };
      return;
    }
    if (tool === 'pen') {
      const ann: PenAnn = { id: uid('a'), type: 'pen', page, points: [p], color: s.color, width: s.strokeWidth };
      this.addAnn(ann);
      this.selectedId.set(ann.id);
      this.gesture = { mode: 'pen', id: ann.id, start: p };
      return;
    }
    // whiteout / highlight / rect
    const box: BoxAnn = {
      id: uid('a'), type: tool as BoxAnn['type'], page, x: p.x, y: p.y, w: 0, h: 0,
      color: s.color, opacity: s.opacity, strokeWidth: s.strokeWidth,
    };
    this.addAnn(box);
    this.selectedId.set(box.id);
    this.gesture = { mode: 'create-box', id: box.id, start: p };
  }

  protected onAnnPointerDown(ev: PointerEvent, a: Ann): void {
    if (this.tool() !== 'select' || ev.button !== 0) return; // let creation flow to the surface
    ev.stopPropagation();
    if (this.editingId() === a.id) return; // typing in a text box
    this.selectAnn(a);
    this.snapshot();
    this.gesture = { mode: 'move', id: a.id, start: this.toLocal(ev), orig: a };
  }

  protected onHandlePointerDown(ev: PointerEvent, a: Ann, corner: Corner): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.selectAnn(a);
    this.snapshot();
    this.gesture = { mode: 'resize', id: a.id, corner, start: this.toLocal(ev), orig: a };
  }

  protected onLinePtPointerDown(ev: PointerEvent, a: LineAnn, which: 1 | 2): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.selectAnn(a);
    this.snapshot();
    this.gesture = { mode: 'line-pt', id: a.id, which, start: this.toLocal(ev), orig: a };
  }

  private annById(id: string): Ann | undefined {
    return this.anns().find((a) => a.id === id);
  }

  protected onPointerMove(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    const p = this.toLocal(ev);
    switch (g.mode) {
      case 'create-box':
        this.updateAnn(g.id, { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) });
        break;
      case 'create-line':
        this.updateAnn(g.id, { x2: p.x, y2: p.y });
        break;
      case 'pen': {
        const ann = this.annById(g.id) as PenAnn | undefined;
        if (!ann) break;
        const last = ann.points[ann.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) this.updateAnn(g.id, { points: [...ann.points, p] });
        break;
      }
      case 'move':
        this.applyMove(g, p);
        break;
      case 'resize':
        this.applyResize(g, p);
        break;
      case 'line-pt':
        this.updateAnn(g.id, g.which === 1 ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y });
        break;
    }
  }

  private applyMove(g: Gesture, p: Pt): void {
    const orig = g.orig!;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (orig.type === 'line') {
      this.updateAnn(g.id, { x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy });
    } else if (orig.type === 'pen') {
      this.updateAnn(g.id, { points: orig.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) });
    } else {
      this.updateAnn(g.id, { x: orig.x + dx, y: orig.y + dy });
    }
  }

  private applyResize(g: Gesture, p: Pt): void {
    const orig = g.orig!;
    if (!isBoxLike(orig)) return;
    const min = orig.type === 'text' ? 40 : 8;
    let { x, y, w, h } = orig;
    const right = x + w;
    const bottom = y + h;
    if (g.corner![0] === 'n') { y = Math.min(p.y, bottom - min); h = bottom - y; }
    else { h = Math.max(min, p.y - y); }
    if (g.corner![1] === 'w') { x = Math.min(p.x, right - min); w = right - x; }
    else { w = Math.max(min, p.x - x); }
    this.updateAnn(g.id, { x, y, w, h });
  }

  protected onPointerUp(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    const ann = this.annById(g.id);
    if (g.mode === 'create-box' && ann && ann.type !== 'line' && ann.type !== 'pen' && 'w' in ann && ann.w < 4 && ann.h < 4) {
      this.removeCreated(g.id);
    } else if (g.mode === 'create-line' && ann?.type === 'line' && Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 4) {
      this.removeCreated(g.id);
    } else if (g.mode === 'pen' && ann?.type === 'pen' && ann.points.length < 2) {
      this.removeCreated(g.id);
    }
  }

  /** Undo a create gesture that produced nothing usable, without leaving history noise. */
  private removeCreated(id: string): void {
    this.anns.update((list) => list.filter((a) => a.id !== id));
    this.past.update((p) => p.slice(0, -1));
    this.future.set([]);
    this.selectedId.set(null);
  }

  // ---- text editing ------------------------------------------------------
  private editSnapshotTaken = false;

  protected startEditing(id: string, fresh = false): void {
    this.selectedId.set(id);
    this.editingId.set(id);
    this.editSnapshotTaken = fresh;
    // The contenteditable mounts a frame after editingId flips (zoneless), so
    // poll for it rather than assuming it exists on the next microtask.
    this.focusEditor(id, 0);
  }

  private focusEditor(id: string, attempt: number): void {
    if (this.editingId() !== id) return;
    const el = document.getElementById(`ann-${id}`);
    if (!el) {
      if (attempt < 60) requestAnimationFrame(() => this.focusEditor(id, attempt + 1));
      return;
    }
    const ann = this.annById(id);
    if (ann?.type === 'text' && el.innerText !== ann.text) el.innerText = ann.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  protected onTextInput(ev: Event, a: TextAnn): void {
    if (!this.editSnapshotTaken) { this.snapshot(); this.editSnapshotTaken = true; }
    const el = ev.target as HTMLElement;
    const h = el.offsetHeight / this.scale();
    this.updateAnn(a.id, { text: el.innerText, h: Math.max(a.fontSize * 1.4, h) });
  }

  protected stopEditing(): void {
    const id = this.editingId();
    if (!id) return;
    this.editingId.set(null);
    const ann = this.annById(id);
    // A click-to-edit that was left unchanged (user clicked text but typed
    // nothing new): drop the cover + text so the page is byte-for-byte as before.
    const meta = this.clickEdits.get(id);
    if (meta) {
      this.clickEdits.delete(id);
      if (ann?.type === 'text' && ann.text === meta.original) {
        this.anns.update((list) => list.filter((a) => a.id !== id && a.id !== meta.cover));
        this.past.update((p) => p.slice(0, -1)); // discard the no-op snapshot
        if (this.selectedId() === id) this.selectedId.set(null);
        return;
      }
    }
    if (ann?.type === 'text' && ann.text.trim() === '') {
      this.anns.update((list) => list.filter((a) => a.id !== id));
      if (this.selectedId() === id) this.selectedId.set(null);
    }
  }

  // ---- image -------------------------------------------------------------
  protected pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.placeImage(file);
    });
    input.click();
  }

  private async placeImage(file: File): Promise<void> {
    try {
      const bytes = await file.arrayBuffer();
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const dim = await new Promise<{ w: number; h: number }>((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
        img.onerror = () => res({ w: 1, h: 1 });
        img.src = dataUrl;
      });
      const w = Math.min(this.pageW() * 0.4, 240);
      const h = w * (dim.h / dim.w);
      const ann: ImageAnn = {
        id: uid('a'), type: 'image', page: this.page(),
        x: (this.pageW() - w) / 2, y: (this.pageH() - h) / 2, w, h,
        dataUrl, mime: file.type || 'image/png', bytes,
      };
      this.snapshot();
      this.addAnn(ann);
      this.selectedId.set(ann.id);
      this.tool.set('select');
    } catch {
      this.toast.error('Could not add image', 'The file could not be read.');
    }
  }

  // ---- keyboard ----------------------------------------------------------
  protected onKeydown(ev: KeyboardEvent): void {
    if (!this.ready()) return;
    const target = ev.target as HTMLElement | null;
    const typing = this.editingId() !== null || (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); this.redo(); return; }
    if (ev.key === 'Escape') { this.stopEditing(); this.selectedId.set(null); return; }
    if (typing) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selectedId()) { ev.preventDefault(); this.deleteSelected(); }
  }

  // ---- find & replace ----------------------------------------------------
  protected toggleFindReplace(): void {
    const open = !this.showFindReplace();
    this.showFindReplace.set(open);
    // Probe the local engine when the panel opens so the status dot is current.
    if (open && this.engineStatus() !== 'up') void this.detectEngine();
  }

  /**
   * Probe the local engine once. When it's reachable and the user hasn't already
   * made a manual choice, default to server mode so the true in-place edit — the
   * headline feature — is on without the user having to find and flip a toggle.
   */
  private async detectEngine(): Promise<void> {
    const up = await this.backend.health();
    if (up && !this.serverModeTouched) this.serverMode.set(true);
  }

  /** Re-probe the engine (the offline panel's "Re-check" button). */
  protected async recheckEngine(): Promise<void> {
    const up = await this.backend.health();
    if (up && !this.serverModeTouched) this.serverMode.set(true);
  }

  /** Copy the one-line command that starts the engine, for the offline notice. */
  protected async copyEngineCmd(): Promise<void> {
    try {
      await navigator.clipboard.writeText('pnpm engine');
      this.toast.success('Copied', 'Paste `pnpm engine` into a terminal in the project folder, then Re-check.');
    } catch {
      this.toast.info('Run this in a terminal', 'pnpm engine');
    }
  }

  /** Flip to server mode; probe the engine so the user sees if it's reachable. */
  protected async setServerMode(on: boolean): Promise<void> {
    this.serverModeTouched = true;
    this.serverMode.set(on);
    if (on && this.engineStatus() !== 'up') {
      const up = await this.backend.health();
      if (!up) {
        this.toast.info(
          'Engine not running',
          'Start it with `pnpm engine` (or `cd server && ./run.sh`), then Re-check. Browser cover-&-restamp still works without it.',
        );
      }
    }
  }

  /**
   * Server-side find & replace: send the current PDF to the local engine, which
   * removes the matched glyphs in place and re-inserts the replacement at the
   * same baseline (not a cover box — a real edit), then re-open the edited bytes
   * and offer the download. Runs on 127.0.0.1 only; the file stays on this device.
   */
  protected async replaceOnServer(): Promise<void> {
    const find = this.findText();
    if (!find || !this.bytes || this.serverBusy()) return;
    this.serverBusy.set(true);
    try {
      const result = await this.backend.replace(this.bytes.slice(0), {
        find,
        replace: this.replaceText(),
        matchCase: this.matchCase(),
        wholeWord: this.wholeWord(),
      });
      this.lastScan.set({ matches: result.matches, pages: result.pages, skipped: 0 });
      if (!result.matches) {
        this.toast.info('No matches', `"${find}" wasn't found in this PDF's text.`);
        return;
      }
      // Re-open the edited document so the real result is on screen.
      const edited = result.bytes.slice().buffer;
      const name = this.fileName() || 'document.pdf';
      await this.load(edited, name, this.sourceDocId);
      this.serverEdited.set(true);
      const blob = this.pdf.toBlob(result.bytes);
      this.output.set([{ name: withSuffix(name, '-replaced'), blob, kindHint: 'edit' }]);
      this.toast.success(
        this.replaceText() ? 'Replaced in document' : 'Removed from document',
        `${result.matches} match${result.matches === 1 ? '' : 'es'} across ${result.pages} page${result.pages === 1 ? '' : 's'} — true in-place edit. Download below, or Save to overwrite.`,
      );
    } catch (e) {
      this.backend.status.set('down');
      this.toast.error(
        'Engine request failed',
        (e instanceof Error ? e.message : 'Could not reach the engine.') +
          ' Is it running? `cd server && ./run.sh`.',
      );
    } finally {
      this.serverBusy.set(false);
    }
  }

  /**
   * Scan the PDF's existing text for the "find" string and, for every match,
   * stage overlays: opaque box(es) covering the original glyphs and a text box
   * with the replacement typed on top. This is cover-and-restamp — the only way
   * to "edit" locked PDF text fully in the browser — so matches land as normal
   * editor annotations the user can nudge, undo and then export.
   *
   * Unlike a naive per-item scan, this assembles each page's text ACROSS runs
   * (pdf.js routinely splits a single word into several text items) with a
   * character→run map, so a match that spans runs is found and each run segment
   * it touches is covered. Per-character x positions come from calibrated canvas
   * measurement (glyph-accurate for proportional fonts), so the cover box and the
   * restamped word sit exactly on the original — not a uniform-width guess.
   */
  protected async runFindReplace(): Promise<void> {
    const find = this.findText();
    if (!find || !this.doc || !this.bytes || this.scanning()) return;
    this.scanning.set(true);
    try {
      const pdfjs = getPdfjs();
      const task = pdfjs.getDocument({ data: new Uint8Array(this.bytes.slice(0)) });
      const jsdoc = await task.promise;
      const cased = this.matchCase();
      const needle = cased ? find : find.toLowerCase();
      const replacement = this.replaceText();
      const wholeWord = this.wholeWord();
      const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
      const measurer = document.createElement('canvas').getContext('2d');
      const staged: Ann[] = [];
      const pagesHit = new Set<number>();
      let matches = 0;
      let skipped = 0;
      try {
        for (let n = 1; n <= jsdoc.numPages; n++) {
          const p = await jsdoc.getPage(n);
          const vp = p.getViewport({ scale: 1 });
          const content = await p.getTextContent();
          const runs = this.buildRuns(n, content, vp, measurer);
          const { text, map } = this.assemblePageText(runs);
          const hay = cased ? text : text.toLowerCase();

          for (let idx = hay.indexOf(needle); idx >= 0; idx = hay.indexOf(needle, idx + Math.max(1, needle.length))) {
            // Honour "whole word only": reject if a letter/digit abuts the match.
            if (wholeWord && (isWordChar(hay[idx - 1]) || isWordChar(hay[idx + needle.length]))) continue;
            // Resolve the matched span back to source runs (separators map to null).
            const chars: MatchChar[] = [];
            for (let k = idx; k < idx + needle.length; k++) {
              const m = map[k];
              if (m) chars.push(m);
            }
            if (!chars.length) continue;
            // Reject matches touching rotated / mirrored / unmeasurable runs.
            if (chars.some((c) => !runs[c.run].ok)) {
              skipped++;
              continue;
            }
            // Group matched chars by run → one cover box per contiguous run segment.
            const byRun = new Map<number, number[]>();
            for (const c of chars) (byRun.get(c.run) ?? byRun.set(c.run, []).get(c.run)!).push(c.ci);
            for (const [r, cis] of byRun) {
              const run = runs[r];
              const a = Math.min(...cis);
              const b = Math.max(...cis);
              const x = run.chars[a].left;
              const right = run.chars[b].left + run.chars[b].w;
              staged.push({
                id: uid('a'), type: 'whiteout', page: n,
                x, y: run.top, w: Math.max(1, right - x), h: run.height,
                color: this.coverColor(), opacity: 1, strokeWidth: 0,
              } satisfies BoxAnn);
            }
            // Restamp the replacement once, anchored to the first matched glyph.
            if (replacement) {
              const first = chars[0];
              const run = runs[first.run];
              const fs = Math.round(run.fontHeight * 10) / 10;
              staged.push({
                id: uid('a'), type: 'text', page: n,
                x: run.chars[first.ci].left, y: run.baseline - run.fontHeight * 0.9,
                w: Math.max(replacement.length * fs * 0.62, 12) + 6, h: fs * 1.4,
                text: replacement, fontSize: fs, color: this.textColor(), bold: run.bold, italic: run.italic, font: run.family,
              } satisfies TextAnn);
            }
            pagesHit.add(n);
            matches++;
          }
          p.cleanup();
        }
      } finally {
        await task.destroy();
      }

      this.lastScan.set({ matches, pages: pagesHit.size, skipped });
      if (!matches) {
        this.toast.info(
          'No matches staged',
          skipped
            ? `Found ${skipped} match(es), but only in rotated text — those can't be replaced automatically.`
            : `"${find}" wasn't found in this PDF's selectable text. Scanned pages or pictures of text won't match.`,
        );
        return;
      }
      this.snapshot();
      this.selectedId.set(null);
      this.stopEditing();
      this.anns.update((list) => [...list, ...staged]);
      const first = Math.min(...pagesHit);
      if (first !== this.page()) this.go(first - this.page());
      this.toast.success(
        replacement ? 'Replacements staged' : 'Redactions staged',
        `${matches} match${matches === 1 ? '' : 'es'} on ${pagesHit.size} page${pagesHit.size === 1 ? '' : 's'}` +
          `${skipped ? `, ${skipped} skipped` : ''}. Review and nudge, then Export.`,
      );
    } catch (e) {
      this.toast.error('Find failed', e instanceof Error ? e.message : 'Could not read this PDF.');
    } finally {
      this.scanning.set(false);
    }
  }

  /** Resolve a page's text items into display-space runs with per-glyph boxes. */
  private buildRuns(
    page: number,
    content: { items: readonly unknown[]; styles?: Record<string, { fontFamily?: string }> },
    vp: { transform: readonly number[] },
    measurer: CanvasRenderingContext2D | null,
  ): TextRun[] {
    const styles = content.styles ?? {};
    const runs: TextRun[] = [];
    for (const raw of content.items) {
      const item = raw as { str?: unknown; width?: number; transform?: readonly number[]; fontName?: string };
      if (typeof item.str !== 'string' || item.str.length === 0 || !item.transform) continue;
      const str = item.str;
      const tx = this.composeMatrix(vp.transform, item.transform);
      const angle = Math.atan2(tx[1], tx[0]);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const left = tx[4];
      const baseline = tx[5];
      const totalW = item.width ?? 0;
      const ok = Math.abs(angle) <= 0.02 && tx[0] > 0 && fontHeight >= 0.5 && totalW > 0;

      const rawFontName = (item.fontName ?? '').toLowerCase();
      const styleFam = (styles[item.fontName ?? '']?.fontFamily ?? '').toLowerCase();
      const fontInfo = `${rawFontName} ${styleFam}`;

      const family: TextFont =
        /mono|courier|consol|menlo|monaco|code|fixed|terminal/.test(fontInfo)
          ? 'mono'
          : /serif|times|georgia|garamond|minion|cambria|palatino|baskerville|century|bookman|roman/.test(fontInfo) && !/sans/.test(fontInfo)
            ? 'serif'
            : 'sans';

      const bold = /bold|black|heavy|semibold|demi|medium|-b|_b|w7|w8|w9|ps-bold/i.test(fontInfo);
      const italic = /italic|oblique|slanted|kursiv|-it|_it|ital|ps-italic/i.test(fontInfo);

      const chars = this.measureChars(str, totalW, left, fontHeight, styles[item.fontName ?? '']?.fontFamily, ok, measurer);
      const endX = chars.length ? chars[chars.length - 1].left + chars[chars.length - 1].w : left;
      runs.push({
        page, str, chars, baseline,
        top: baseline - fontHeight * 0.82, height: fontHeight * 1.04,
        fontHeight, endX, ok, family, bold, italic,
      });
    }
    return runs;
  }

  /**
   * Per-character {left, width} for a run. Widths come from canvas text metrics
   * (kerning-aware prefix measurement) scaled so the measured total equals the
   * run's true advance — accurate for proportional fonts. Falls back to uniform
   * spacing when the run is rotated, over-long, or unmeasurable.
   */
  private measureChars(
    str: string, totalW: number, left: number, fontHeight: number,
    family: string | undefined, ok: boolean, measurer: CanvasRenderingContext2D | null,
  ): { left: number; w: number }[] {
    const uniform = () => {
      const cw = str.length ? totalW / str.length : 0;
      return Array.from(str, (_, i) => ({ left: left + i * cw, w: cw }));
    };
    if (!ok || !measurer || str.length > 400) return uniform();
    measurer.font = `${Math.max(1, fontHeight)}px ${family || 'sans-serif'}`;
    const prefix: number[] = [0];
    for (let i = 1; i <= str.length; i++) {
      const w = measurer.measureText(str.slice(0, i)).width;
      if (!Number.isFinite(w)) return uniform();
      prefix.push(w);
    }
    const full = prefix[str.length];
    if (full <= 0) return uniform();
    const k = totalW / full;
    return Array.from(str, (_, i) => ({ left: left + prefix[i] * k, w: (prefix[i + 1] - prefix[i]) * k }));
  }

  /**
   * Concatenate a page's runs into one searchable string, inserting a single
   * space between runs separated by a visible gap or a line break, and a map
   * from each character back to its source run (null for inserted separators).
   */
  private assemblePageText(runs: TextRun[]): { text: string; map: (MatchChar | null)[] } {
    let text = '';
    const map: (MatchChar | null)[] = [];
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      if (r > 0 && text && text[text.length - 1] !== ' ') {
        const prev = runs[r - 1];
        const em = Math.max(prev.fontHeight, run.fontHeight);
        const sameLine = Math.abs(run.baseline - prev.baseline) <= em * 0.5;
        const gap = run.chars.length ? run.chars[0].left - prev.endX : 0;
        if (!sameLine || gap > run.fontHeight * 0.25) {
          text += ' ';
          map.push(null);
        }
      }
      for (let ci = 0; ci < run.str.length; ci++) {
        text += run.str[ci];
        map.push({ run: r, ci });
      }
    }
    return { text, map };
  }

  /** Multiply two pdf.js [a,b,c,d,e,f] affine matrices (m1 ∘ m2). */
  private composeMatrix(m1: readonly number[], m2: readonly number[]): number[] {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  // ---- export ------------------------------------------------------------
  protected readonly hasEdits = computed(() => this.serverEdited() || this.anns().some((a) => a.type !== 'text' || a.text.trim() !== ''));

  private buildEditAnnotations(): EditAnnotation[] {
    const out: EditAnnotation[] = [];
    for (const a of this.anns()) {
      if (a.type === 'text') {
        if (a.text.trim() === '') continue;
        out.push({ kind: 'text', page: a.page, x: a.x, y: a.y, w: a.w, text: a.text, fontSize: a.fontSize, color: hexToRgb01(a.color), bold: a.bold, italic: a.italic, font: a.font });
      } else if (a.type === 'whiteout' || a.type === 'highlight') {
        out.push({ kind: 'rect', page: a.page, x: a.x, y: a.y, w: a.w, h: a.h, fill: hexToRgb01(a.color), fillOpacity: a.opacity });
      } else if (a.type === 'rect') {
        out.push({ kind: 'rect', page: a.page, x: a.x, y: a.y, w: a.w, h: a.h, stroke: hexToRgb01(a.color), strokeWidth: a.strokeWidth });
      } else if (a.type === 'line') {
        out.push({ kind: 'line', page: a.page, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color: hexToRgb01(a.color), width: a.width });
      } else if (a.type === 'pen') {
        out.push({ kind: 'pen', page: a.page, points: a.points, color: hexToRgb01(a.color), width: a.width });
      } else if (a.type === 'image') {
        out.push({ kind: 'image', page: a.page, x: a.x, y: a.y, w: a.w, h: a.h, bytes: a.bytes, mime: a.mime });
      }
    }
    return out;
  }

  private async stamp(): Promise<Blob | null> {
    if (!this.bytes) return null;
    const edits = this.buildEditAnnotations();
    if (!edits.length && !this.serverEdited()) { this.toast.info('Nothing to apply', 'Add text, shapes or drawings first.'); return null; }
    const bytes = await this.pdf.applyEdits(this.bytes, edits);
    return this.pdf.toBlob(bytes);
  }

  protected async exportPdf(): Promise<void> {
    this.stopEditing();
    this.busy.set(true);
    try {
      const blob = await this.stamp();
      if (!blob) return;
      this.output.set([{ name: withSuffix(this.fileName() || 'document.pdf', '-edited'), blob, kindHint: 'edit' }]);
      this.toast.success('PDF edited', 'Your changes have been burned into a new PDF.');
    } catch (e) {
      this.toast.error('Export failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveToOriginal(): Promise<void> {
    if (!this.sourceDocId) return;
    const ok = await this.confirm.ask({
      title: 'Overwrite the original?',
      message: 'This replaces the stored file in your library with the edited version. The previous content cannot be recovered.',
      confirmText: 'Overwrite',
      danger: true,
    });
    if (!ok) return;
    this.stopEditing();
    this.busy.set(true);
    try {
      const blob = await this.stamp();
      if (!blob) return;
      await this.library.updateContent(this.sourceDocId, blob);
      this.toast.success('Saved', 'The original file now contains your edits.');
    } catch (e) {
      this.toast.error('Save failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly canOverwrite = computed(() => this.sourceDocId !== null);

  // ---- template helpers --------------------------------------------------
  protected box(a: Ann): { x: number; y: number; w: number; h: number } {
    const b = a as Partial<{ x: number; y: number; w: number; h: number }>;
    return { x: b.x ?? 0, y: b.y ?? 0, w: b.w ?? 0, h: b.h ?? 0 };
  }

  protected penPath(a: PenAnn): string {
    return a.points.map((p) => `${p.x},${p.y}`).join(' ');
  }

  protected penBBox(a: PenAnn): { x: number; y: number; w: number; h: number } {
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  protected readonly corners: Corner[] = ['nw', 'ne', 'sw', 'se'];

  protected readonly tools: { tool: EditTool; icon: IconName; label: string }[] = [
    { tool: 'select', icon: 'arrow-up-down', label: 'Edit text / select' },
    { tool: 'text', icon: 'type', label: 'Add text' },
    { tool: 'whiteout', icon: 'eraser', label: 'Whiteout / cover' },
    { tool: 'highlight', icon: 'highlighter', label: 'Highlight' },
    { tool: 'rect', icon: 'shapes', label: 'Rectangle' },
    { tool: 'line', icon: 'pencil', label: 'Line' },
    { tool: 'pen', icon: 'pen-tool', label: 'Draw (pen)' },
    { tool: 'image', icon: 'image-plus', label: 'Insert image' },
  ];

  protected readonly features = [
    { icon: 'replace' as IconName, title: 'Find & replace', desc: 'Swap a word everywhere — covers the old text and restamps the new.' },
    { icon: 'eraser' as IconName, title: 'Cover & replace', desc: 'White out locked text, then type new text over it.' },
    { icon: 'pen-tool' as IconName, title: 'Draw & annotate', desc: 'Freehand pen, lines, boxes and highlights.' },
    { icon: 'image-plus' as IconName, title: 'Sign & stamp', desc: 'Drop in a signature image or logo anywhere.' },
  ];

  protected cornerCursor(c: Corner): string {
    return c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize';
  }

  protected exit(): void {
    void this.router.navigate(['/tools']);
  }

  protected startOver(): void {
    this.doc = null;
    this.bytes = null;
    this.ready.set(false);
    this.output.set([]);
    this.anns.set([]);
    this.serverEdited.set(false);
    this.sourceDocId = null;
    this.runCache.clear();
    this.clickEdits.clear();
    this.reflowSel.set(null);
    this.reflowMode.set(false);
  }
}
