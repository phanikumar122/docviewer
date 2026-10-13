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
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import * as mammoth from 'mammoth';
import { marked } from 'marked';
import { IconComponent } from '../../shared/components/icon.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';
import { LibraryService } from '../../core/services/library.service';
import { ToastService } from '../../core/services/toast.service';
import { sanitizeHtml } from '../../shared/util/sanitize';
import { htmlToMarkdown } from './html-to-markdown';
import { changeExt } from '../../shared/util/format';
import type { DocFile } from '../../core/models';

type EditorMode = 'rich' | 'code';
type SaveState = 'idle' | 'saving' | 'saved' | 'unsaved';

@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.css',
  host: { class: 'flex h-full min-h-0 flex-col' },
})
export class EditorComponent {
  readonly id = input<string | undefined>(undefined);

  private readonly library = inject(LibraryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly richRef = viewChild<ElementRef<HTMLDivElement>>('rich');
  private readonly codeRef = viewChild<ElementRef<HTMLTextAreaElement>>('codeArea');

  protected readonly file = computed<DocFile | undefined>(() => (this.id() ? this.library.fileById(this.id()!) : undefined));
  protected readonly mode = signal<EditorMode>('rich');
  protected readonly docName = signal('Untitled document');
  protected readonly loading = signal(false);
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly code = signal('');
  protected readonly showExport = signal(false);
  protected readonly mdPreview = signal(false);
  protected readonly renderedPreview = signal<SafeHtml>('');

  /** True once the user has made an edit, to avoid saving the pristine seed. */
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedForId: string | null | undefined = undefined;

  protected readonly isMarkdown = computed(() => this.file()?.kind === 'markdown');

  constructor() {
    effect(() => {
      const f = this.file();
      const key = this.id() ?? null;
      if (this.loadedForId === key) return;
      this.loadedForId = key;
      void this.loadInitial(f);
    });

    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
    });

    // Warn before leaving with unsaved changes.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (this.saveState() === 'unsaved' || this.saveState() === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    this.destroyRef.onDestroy(() => window.removeEventListener('beforeunload', beforeUnload));
  }

  private async loadInitial(file: DocFile | undefined): Promise<void> {
    this.dirty = false;
    this.saveState.set('idle');
    if (!file) {
      // New document → blank rich editor
      this.mode.set('rich');
      this.docName.set('Untitled document');
      queueMicrotask(() => {
        const el = this.richRef()?.nativeElement;
        if (el) el.innerHTML = '<p><br></p>';
      });
      return;
    }

    this.docName.set(file.name);
    this.loading.set(true);
    try {
      const blob = await this.library.getBlob(file.id);
      if (!blob) throw new Error('missing');
      if (file.kind === 'word') {
        this.mode.set('rich');
        const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        const safe = sanitizeHtml(value || '<p><br></p>');
        queueMicrotask(() => {
          const el = this.richRef()?.nativeElement;
          if (el) el.innerHTML = safe;
        });
        this.toast.info('Imported from Word', 'Formatting is approximate. Export as HTML/Markdown to save a copy.');
      } else {
        // text / markdown / json / xml → code editor
        this.mode.set('code');
        this.code.set(await blob.text());
        if (this.isMarkdown()) void this.updatePreview();
      }
    } catch {
      this.toast.error('Could not open for editing');
    } finally {
      this.loading.set(false);
    }
  }

  // ---- rich text commands ------------------------------------------------
  /**
   * Inline/block formatting still goes through document.execCommand. It is
   * deprecated but remains the only broadly-supported way to toggle rich
   * formatting inside a contenteditable across Chromium/Firefox/WebKit; there
   * is no stable standards replacement short of a full editing engine. Newer,
   * cleaner operations (links) are implemented against the Selection API below.
   */
  protected exec(command: string, value?: string): void {
    this.richRef()?.nativeElement.focus();
    document.execCommand(command, false, value);
    this.onRichInput();
  }

  protected makeHeading(tag: string): void {
    this.exec('formatBlock', tag);
  }

  protected addLink(): void {
    const editor = this.richRef()?.nativeElement;
    if (!editor) return;
    // Capture the live selection *before* prompt() steals focus and collapses it.
    const sel = window.getSelection();
    const saved =
      sel && sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;

    const raw = window.prompt('Link URL', 'https://');
    const text = raw?.trim();
    if (!text) return;
    const url = this.normalizeUrl(text);
    if (!url) return;

    // Selection/Range insertion instead of the deprecated execCommand('createLink'),
    // which silently no-ops when nothing is selected.
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    const range =
      saved ??
      (() => {
        const r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
        return r;
      })();

    if (!range.collapsed) {
      anchor.appendChild(range.extractContents());
      range.insertNode(anchor);
    } else {
      anchor.textContent = text;
      range.insertNode(anchor);
    }

    // Drop the caret just after the new link.
    const after = document.createRange();
    after.setStartAfter(anchor);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    editor.focus();
    this.onRichInput();
  }

  /** Trust explicit safe schemes; treat bare addresses as https (or mailto). */
  private normalizeUrl(input: string): string | null {
    if (!input) return null;
    if (/^(https?:|mailto:|tel:)/i.test(input)) return input;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return `mailto:${input}`;
    return `https://${input.replace(/^\/+/, '')}`;
  }

  protected onRichInput(): void {
    this.markDirty();
  }

  protected onCodeInput(value: string): void {
    this.code.set(value);
    this.markDirty();
    if (this.isMarkdown() && this.mdPreview()) void this.updatePreview();
  }

  private markDirty(): void {
    this.dirty = true;
    this.saveState.set('unsaved');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.autosave(), 900);
  }

  // ---- autosave (draft + write-back for existing text files) -------------
  private async autosave(): Promise<void> {
    if (!this.dirty) return;
    this.saveState.set('saving');
    const f = this.file();
    try {
      if (f && this.mode() === 'code') {
        // Write text content straight back to the existing file.
        await this.library.updateContent(f.id, new Blob([this.code()], { type: f.mime || 'text/plain' }));
      } else {
        // Rich / new doc → persist a draft keyed by file id (or 'new').
        await this.library.saveDraft(f?.id ?? 'new', this.currentHtml(), 'html');
      }
      this.saveState.set('saved');
    } catch {
      this.saveState.set('unsaved');
    }
  }

  protected currentHtml(): string {
    return this.richRef()?.nativeElement.innerHTML ?? '';
  }

  private currentPlainText(): string {
    return this.richRef()?.nativeElement.innerText ?? '';
  }

  // ---- export / save-as --------------------------------------------------
  protected async exportAs(format: 'html' | 'md' | 'txt'): Promise<void> {
    this.showExport.set(false);
    const name = this.docName().trim() || 'document';
    let blob: Blob;
    let outName: string;
    if (this.mode() === 'code') {
      blob = new Blob([this.code()], { type: 'text/plain' });
      outName = this.file()?.name ?? `${name}.txt`;
      if (format === 'md') outName = changeExt(outName, 'md');
      if (format === 'html') { blob = new Blob([this.code()], { type: 'text/html' }); outName = changeExt(outName, 'html'); }
    } else {
      const html = this.currentHtml();
      if (format === 'html') {
        blob = new Blob([this.wrapHtml(html)], { type: 'text/html' });
        outName = changeExt(name, 'html');
      } else if (format === 'md') {
        blob = new Blob([htmlToMarkdown(html)], { type: 'text/markdown' });
        outName = changeExt(name, 'md');
      } else {
        blob = new Blob([this.currentPlainText()], { type: 'text/plain' });
        outName = changeExt(name, 'txt');
      }
    }
    const doc = await this.library.saveOutput(blob, outName, 'editor', this.file()?.folderId ?? null, 'edit', `Exported ${outName}`);
    this.saveState.set('saved');
    this.dirty = false;
    this.toast.success('Saved to library', outName);
    void this.router.navigate(['/viewer', doc.id]);
  }

  protected async saveText(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.autosave();
    this.toast.success('Saved');
  }

  private wrapHtml(body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${this.docName()}</title></head><body>${body}</body></html>`;
  }

  protected toggleMdPreview(): void {
    this.mdPreview.update((v) => !v);
    if (this.mdPreview()) void this.updatePreview();
  }

  private async updatePreview(): Promise<void> {
    const html = await marked.parse(this.code());
    this.renderedPreview.set(this.sanitizer.bypassSecurityTrustHtml(sanitizeHtml(html)));
  }

  protected back(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/files']);
  }
}
