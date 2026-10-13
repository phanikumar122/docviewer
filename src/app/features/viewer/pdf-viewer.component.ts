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
import { getPdfjs } from '../../core/pdf/pdfjs-loader';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { IconComponent } from '../../shared/components/icon.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { IntersectDirective } from '../../shared/directives/intersect.directive';
import type { DocFile } from '../../core/models';

interface Thumb { page: number; dataUrl: string | null; key: string; }
interface OutlineNode { title: string; page: number | null; }

@Component({
  selector: 'app-pdf-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent, IntersectDirective],
  templateUrl: './pdf-viewer.component.html',
  styleUrl: './pdf-viewer.component.css',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class PdfViewerComponent {
  readonly file = input.required<DocFile>();
  readonly blob = input.required<Blob>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly textLayerRef = viewChild<ElementRef<HTMLDivElement>>('textLayer');
  private readonly scrollRef = viewChild<ElementRef<HTMLDivElement>>('scroll');

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly numPages = signal(0);
  protected readonly page = signal(1);
  protected readonly scale = signal(1.2);
  protected readonly rotation = signal(0);
  protected readonly fitMode = signal<'none' | 'width' | 'page'>('width');

  protected readonly showThumbs = signal(true);
  protected readonly showSearch = signal(false);
  protected readonly thumbs = signal<Thumb[]>([]);
  protected readonly outline = signal<OutlineNode[]>([]);

  protected readonly query = signal('');
  protected readonly matches = signal<{ page: number; count: number }[]>([]);
  protected readonly searching = signal(false);
  protected readonly activeMatchIdx = signal(-1);
  private pageText: string[] = [];
  /** Flat page-per-occurrence map so match stepping can cross pages. */
  private matchPositions: number[] = [];

  protected readonly totalMatches = computed(() => this.matches().reduce((n, m) => n + m.count, 0));

  private doc: PDFDocumentProxy | null = null;
  private loadingTask: ReturnType<ReturnType<typeof getPdfjs>['getDocument']> | null = null;
  private renderToken = 0;
  /** Bumped on each document load so stale thumbnail renders are discarded. */
  private thumbEpoch = 0;
  private readonly thumbRendering = new Set<number>();

  constructor() {
    // Load document whenever the blob changes.
    effect(() => {
      const blob = this.blob();
      void this.load(blob);
    });

    // Re-render the current page on page/scale/rotation changes.
    effect(() => {
      this.page();
      this.scale();
      this.rotation();
      if (this.doc) void this.renderCurrent();
    });

    this.destroyRef.onDestroy(() => {
      void this.loadingTask?.destroy();
    });
  }

  private async load(blob: Blob): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.thumbs.set([]);
    this.outline.set([]);
    this.pageText = [];
    this.matches.set([]);
    this.matchPositions = [];
    this.activeMatchIdx.set(-1);
    try {
      const pdfjs = getPdfjs();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (this.loadingTask) await this.loadingTask.destroy();
      this.loadingTask = pdfjs.getDocument({ data: bytes });
      this.doc = await this.loadingTask.promise;
      this.numPages.set(this.doc.numPages);
      this.page.set(1);
      this.seedThumbs(this.doc.numPages);
      await this.loadOutline();
      this.loading.set(false);
      // defer first render until the canvas exists
      queueMicrotask(() => void this.applyFit());
    } catch (e) {
      this.error.set(
        `Could not open this PDF. It may be corrupted or password-protected. (${e instanceof Error ? e.message : 'unknown'})`,
      );
      this.loading.set(false);
    }
  }

  private async loadOutline(): Promise<void> {
    if (!this.doc) return;
    try {
      const raw = await this.doc.getOutline();
      if (!raw?.length) return;
      const nodes: OutlineNode[] = [];
      for (const item of raw) {
        let page: number | null = null;
        try {
          const dest = typeof item.dest === 'string' ? await this.doc.getDestination(item.dest) : item.dest;
          if (dest && dest[0]) {
            page = (await this.doc.getPageIndex(dest[0] as never)) + 1;
          }
        } catch { /* ignore unresolved dest */ }
        nodes.push({ title: item.title, page });
      }
      this.outline.set(nodes);
    } catch { /* no outline */ }
  }

  // ---- rendering ---------------------------------------------------------
  private async renderCurrent(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const doc = this.doc;
    if (!canvas || !doc) return;
    const token = ++this.renderToken;
    const page = await doc.getPage(this.page());
    if (token !== this.renderToken) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: this.scale(), rotation: this.rotation() });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvas, viewport }).promise;
    if (token !== this.renderToken) return;
    await this.renderTextLayer(page, viewport);
    page.cleanup();
  }

  private async renderTextLayer(page: PDFPageProxy, viewport: PageViewport): Promise<void> {
    const container = this.textLayerRef()?.nativeElement;
    if (!container) return;
    container.replaceChildren();
    container.style.width = `${Math.floor(viewport.width)}px`;
    container.style.height = `${Math.floor(viewport.height)}px`;
    try {
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      await textLayer.render();
      this.highlightMatches();
    } catch { /* selection unavailable for this page */ }
  }

  private seedThumbs(count: number): void {
    const epoch = ++this.thumbEpoch;
    this.thumbRendering.clear();
    // Keys are epoch-scoped so switching documents recreates the thumb elements
    // and re-arms their IntersectionObservers for the new pages.
    this.thumbs.set(
      Array.from({ length: count }, (_, i) => ({ page: i + 1, dataUrl: null, key: `${epoch}-${i + 1}` })),
    );
  }

  /** Render a single thumbnail on demand, when its slot scrolls into view. */
  protected async renderThumb(page: number): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const epoch = this.thumbEpoch;
    if (this.thumbRendering.has(page)) return;
    const existing = this.thumbs().find((t) => t.page === page);
    if (!existing || existing.dataUrl) return;
    this.thumbRendering.add(page);
    try {
      const p = await doc.getPage(page);
      const viewport = p.getViewport({ scale: 0.2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await p.render({ canvas, viewport }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.6);
      p.cleanup();
      if (epoch !== this.thumbEpoch) return; // a newer document loaded meanwhile
      this.thumbs.update((t) => t.map((x) => (x.page === page ? { ...x, dataUrl: url } : x)));
    } catch {
      /* skip */
    } finally {
      this.thumbRendering.delete(page);
    }
  }

  // ---- navigation / zoom -------------------------------------------------
  protected go(delta: number): void {
    this.page.set(Math.min(this.numPages(), Math.max(1, this.page() + delta)));
    this.scrollTop();
  }
  protected goTo(n: number): void {
    if (n >= 1 && n <= this.numPages()) {
      this.page.set(n);
      this.scrollTop();
    }
  }
  protected onPageInput(value: string): void {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n)) this.goTo(n);
  }
  private scrollTop(): void {
    this.scrollRef()?.nativeElement.scrollTo({ top: 0 });
  }

  protected zoom(delta: number): void {
    this.fitMode.set('none');
    this.scale.set(Math.min(4, Math.max(0.25, +(this.scale() + delta).toFixed(2))));
  }
  protected setFit(mode: 'width' | 'page'): void {
    this.fitMode.set(mode);
    void this.applyFit();
  }
  private async applyFit(): Promise<void> {
    const doc = this.doc;
    const scroller = this.scrollRef()?.nativeElement;
    if (!doc || !scroller || this.fitMode() === 'none') {
      if (this.doc) void this.renderCurrent();
      return;
    }
    const page = await doc.getPage(this.page());
    const base = page.getViewport({ scale: 1, rotation: this.rotation() });
    const availW = scroller.clientWidth - 48;
    const availH = scroller.clientHeight - 48;
    const scale = this.fitMode() === 'width' ? availW / base.width : Math.min(availW / base.width, availH / base.height);
    page.cleanup();
    this.scale.set(+Math.max(0.25, scale).toFixed(3));
  }
  protected rotate(delta: number): void {
    this.rotation.set((this.rotation() + delta + 360) % 360);
    if (this.fitMode() !== 'none') void this.applyFit();
  }

  // ---- search ------------------------------------------------------------
  protected async runSearch(): Promise<void> {
    const q = this.query().trim().toLowerCase();
    if (!q || !this.doc) {
      this.clearSearch();
      return;
    }
    this.searching.set(true);
    try {
      if (this.pageText.length === 0) await this.buildTextIndex();
      const results: { page: number; count: number }[] = [];
      const positions: number[] = [];
      this.pageText.forEach((text, i) => {
        let count = 0;
        let idx = text.indexOf(q);
        while (idx !== -1) {
          count++;
          positions.push(i + 1);
          idx = text.indexOf(q, idx + q.length);
        }
        if (count) results.push({ page: i + 1, count });
      });
      this.matches.set(results);
      this.matchPositions = positions;
      if (positions.length) {
        this.goToMatch(0);
      } else {
        this.activeMatchIdx.set(-1);
      }
    } finally {
      this.searching.set(false);
    }
  }

  private clearSearch(): void {
    this.matches.set([]);
    this.matchPositions = [];
    this.activeMatchIdx.set(-1);
    this.highlightMatches();
  }

  /** Jump to the Nth global match (across pages) and highlight it. */
  protected stepMatch(delta: number): void {
    const n = this.matchPositions.length;
    if (!n) return;
    let i = this.activeMatchIdx() + delta;
    if (i < 0) i = n - 1;
    if (i >= n) i = 0;
    this.goToMatch(i);
  }

  private goToMatch(i: number): void {
    const target = this.matchPositions[i];
    if (target == null) return;
    this.activeMatchIdx.set(i);
    if (this.page() !== target) {
      this.page.set(target); // render effect re-renders the page (and re-highlights)
      this.scrollTop();
    } else {
      // Same page: re-render so highlights (and the active match) refresh cleanly.
      void this.renderCurrent();
    }
  }

  /** Jump to the first match occurrence on a given page (match-list click). */
  protected goToPage(page: number): void {
    const i = this.matchPositions.indexOf(page);
    if (i !== -1) this.goToMatch(i);
    else this.goTo(page);
  }

  /** Which occurrence (0-based) on the current page is the active match, if any. */
  private activeOccurrenceOnPage(): number {
    const idx = this.activeMatchIdx();
    if (idx < 0) return -1;
    const target = this.matchPositions[idx];
    if (target !== this.page()) return -1;
    let occ = 0;
    for (let k = 0; k < idx; k++) if (this.matchPositions[k] === target) occ++;
    return occ;
  }

  /** Wrap query hits in the live text layer with <mark>, flagging the active one. */
  private highlightMatches(): void {
    const container = this.textLayerRef()?.nativeElement;
    if (!container) return;
    const q = this.query().trim();
    if (!q || this.matches().length === 0) return;
    const needle = q.toLowerCase();
    const activeOcc = this.activeOccurrenceOnPage();
    let occ = 0;
    let activeEl: HTMLElement | null = null;
    for (const span of Array.from(container.querySelectorAll<HTMLElement>('span'))) {
      const text = span.textContent ?? '';
      if (!text) continue;
      const lower = text.toLowerCase();
      let from = lower.indexOf(needle);
      if (from === -1) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      while (from !== -1) {
        if (from > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, from)));
        const mark = document.createElement('mark');
        mark.className = 'pdf-match';
        if (occ === activeOcc) {
          mark.classList.add('is-active');
          activeEl = mark;
        }
        mark.textContent = text.slice(from, from + q.length);
        frag.appendChild(mark);
        occ++;
        cursor = from + q.length;
        from = lower.indexOf(needle, cursor);
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      span.replaceChildren(frag);
    }
    if (activeEl) queueMicrotask(() => activeEl?.scrollIntoView({ block: 'center' }));
  }

  private async buildTextIndex(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').toLowerCase());
      page.cleanup();
    }
    this.pageText = texts;
  }

  protected toggleThumbs(): void { this.showThumbs.update((v) => !v); }
  protected toggleSearch(): void { this.showSearch.update((v) => !v); }
}
