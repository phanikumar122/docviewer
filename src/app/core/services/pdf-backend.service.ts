import { Injectable, signal } from '@angular/core';

/** Result of a server-side replace: the edited bytes plus simple stats. */
export interface ReplaceResult {
  bytes: Uint8Array;
  matches: number;
  pages: number;
}

export interface ReplaceOptions {
  find: string;
  replace: string;
  matchCase?: boolean;
  wholeWord?: boolean;
}

/** Which optional conversion features the running engine reports. */
export interface EngineFeatures {
  replace: boolean;
  protect: boolean;
  unlock: boolean;
  pdfToWord: boolean;
  wordToPdf: boolean;
  excelToPdf: boolean;
  pdfToExcel: boolean;
  pptToPdf: boolean;
  pdfToPpt: boolean;
  ocr: boolean;
  reflow: boolean;
  editPptx: boolean;
}

export interface ReflowEdit {
  page: number;
  rect: [number, number, number, number];
  text: string;
  fontSize?: number;
  font?: 'sans' | 'serif' | 'mono';
  align?: 'left' | 'center' | 'right' | 'justify';
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface PptxOutline {
  count: number;
  slides: { index: number; paras: { id: string; text: string }[] }[];
}

export interface ProtectOptions {
  userPassword: string;
  ownerPassword?: string;
  allowPrint?: boolean;
  allowCopy?: boolean;
  allowModify?: boolean;
}

/**
 * Client for the optional local DocuFlow PDF engine (`server/app.py`, PyMuPDF).
 *
 * The browser can only *cover* existing PDF text and stamp new text on top; the
 * original glyphs stay in the file. This engine does a TRUE in-place edit —
 * it removes the matched glyphs from the page and re-inserts the replacement at
 * the same baseline, preserving the rest of the layout. It runs on loopback
 * (127.0.0.1) only, so the PDF is sent to a process on this machine and never
 * leaves the device, but it is a separate opt-in step from the all-browser flow.
 */
@Injectable({ providedIn: 'root' })
export class PdfBackendService {
  /** Overridable (e.g. from Settings) — defaults to the loopback engine port. */
  readonly baseUrl = signal(this.resolveBaseUrl());

  /** 'unknown' until first probed; cached so the panel can show a status dot. */
  readonly status = signal<'unknown' | 'up' | 'down'>('unknown');
  readonly engineVersion = signal<string | null>(null);
  /** Which conversion features the engine advertises (from /api/health). */
  readonly features = signal<EngineFeatures | null>(null);

  private resolveBaseUrl(): string {
    const override = (globalThis as { DOCUFLOW_ENGINE_URL?: string }).DOCUFLOW_ENGINE_URL;
    return override || 'http://127.0.0.1:8787';
  }

  /** Ping the engine. Returns true if reachable; also updates `status`. */
  async health(timeoutMs = 2500): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl()}/api/health`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { ok?: boolean; version?: string; features?: EngineFeatures };
      this.status.set(body.ok ? 'up' : 'down');
      this.engineVersion.set(body.version ?? null);
      this.features.set(body.features ?? null);
      return !!body.ok;
    } catch {
      this.status.set('down');
      this.engineVersion.set(null);
      this.features.set(null);
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /** Send the PDF to the engine for a true in-place find & replace. */
  async replace(bytes: ArrayBuffer, opts: ReplaceOptions): Promise<ReplaceResult> {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'document.pdf');
    form.append(
      'options',
      JSON.stringify({
        find: opts.find,
        replace: opts.replace,
        matchCase: !!opts.matchCase,
        wholeWord: !!opts.wholeWord,
      }),
    );
    const res = await fetch(`${this.baseUrl()}/api/replace`, { method: 'POST', body: form });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        if (err.error) detail = err.error;
      } catch {
        /* non-JSON error body */
      }
      this.status.set('down');
      throw new Error(detail);
    }
    const matches = Number(res.headers.get('X-Matches') ?? '0');
    const pages = Number(res.headers.get('X-Pages') ?? '0');
    const out = new Uint8Array(await res.arrayBuffer());
    this.status.set('up');
    return { bytes: out, matches, pages };
  }

  /** POST a file + options to an engine endpoint and return the raw bytes. */
  private async postFile(path: string, bytes: ArrayBuffer, filename: string, options: unknown): Promise<{ bytes: Uint8Array; headers: Headers }> {
    const form = new FormData();
    form.append('file', new Blob([bytes]), filename);
    form.append('options', JSON.stringify(options ?? {}));
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, { method: 'POST', body: form });
    } catch (e) {
      this.status.set('down');
      throw new Error(e instanceof Error ? e.message : 'Could not reach the engine.');
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        if (err.error) detail = err.error;
      } catch {
        /* non-JSON body */
      }
      throw new Error(detail);
    }
    this.status.set('up');
    return { bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
  }

  /** Password-protect (encrypt) a PDF. Returns the encrypted bytes. */
  async protect(bytes: ArrayBuffer, opts: ProtectOptions): Promise<Uint8Array> {
    return (await this.postFile('/api/protect', bytes, 'document.pdf', opts)).bytes;
  }

  /** Remove a password from a PDF (needs the current open password). */
  async unlock(bytes: ArrayBuffer, password: string): Promise<{ bytes: Uint8Array; wasEncrypted: boolean }> {
    const r = await this.postFile('/api/unlock', bytes, 'document.pdf', { password });
    return { bytes: r.bytes, wasEncrypted: r.headers.get('X-Was-Encrypted') === '1' };
  }

  /** Convert a PDF to an editable .docx (Word) document. */
  async pdfToWord(bytes: ArrayBuffer, password = ''): Promise<Uint8Array> {
    return (await this.postFile('/api/pdf-to-word', bytes, 'document.pdf', { password })).bytes;
  }

  /** Convert a .docx (Word) document to PDF. */
  async wordToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
    return (await this.postFile('/api/word-to-pdf', bytes, 'document.docx', {})).bytes;
  }

  /** Convert an .xlsx (Excel) workbook to PDF. */
  async excelToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
    return (await this.postFile('/api/excel-to-pdf', bytes, 'book.xlsx', {})).bytes;
  }

  /** Extract tables from a PDF into an .xlsx workbook. */
  async pdfToExcel(bytes: ArrayBuffer): Promise<{ bytes: Uint8Array; tables: number }> {
    const r = await this.postFile('/api/pdf-to-excel', bytes, 'document.pdf', {});
    return { bytes: r.bytes, tables: Number(r.headers.get('X-Tables') ?? '0') };
  }

  /** Convert a .pptx (PowerPoint) deck to PDF. */
  async pptToPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
    return (await this.postFile('/api/ppt-to-pdf', bytes, 'deck.pptx', {})).bytes;
  }

  /** Convert a PDF to a .pptx deck (one slide image per page). */
  async pdfToPpt(bytes: ArrayBuffer): Promise<Uint8Array> {
    return (await this.postFile('/api/pdf-to-ppt', bytes, 'document.pdf', {})).bytes;
  }

  /** OCR a scanned PDF into a searchable PDF. */
  async ocr(bytes: ArrayBuffer, language = 'eng'): Promise<{ bytes: Uint8Array; pages: number }> {
    const r = await this.postFile('/api/ocr', bytes, 'document.pdf', { language });
    return { bytes: r.bytes, pages: Number(r.headers.get('X-Ocr-Pages') ?? '0') };
  }

  /** Rewrite whole paragraphs in place with real re-wrapping. */
  async reflow(bytes: ArrayBuffer, edits: ReflowEdit[]): Promise<Uint8Array> {
    return (await this.postFile('/api/reflow', bytes, 'document.pdf', { edits })).bytes;
  }

  /** List the editable text of a .pptx deck. */
  async pptxOutline(bytes: ArrayBuffer): Promise<PptxOutline> {
    const res = await fetch(`${this.baseUrl()}/api/pptx-outline`, { method: 'POST', body: this.form(bytes, 'deck.pptx', {}) });
    if (!res.ok) throw new Error(await this.errText(res));
    this.status.set('up');
    return (await res.json()) as PptxOutline;
  }

  /** Apply text edits / slide delete+reorder to a .pptx deck. */
  async pptxApply(bytes: ArrayBuffer, opts: { edits?: { id: string; text: string }[]; delete?: number[]; order?: number[] }): Promise<Uint8Array> {
    return (await this.postFile('/api/pptx-apply', bytes, 'deck.pptx', opts)).bytes;
  }

  private form(bytes: ArrayBuffer, filename: string, options: unknown): FormData {
    const f = new FormData();
    f.append('file', new Blob([bytes]), filename);
    f.append('options', JSON.stringify(options ?? {}));
    return f;
  }

  private async errText(res: Response): Promise<string> {
    try {
      const err = (await res.json()) as { error?: string };
      return err.error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}
