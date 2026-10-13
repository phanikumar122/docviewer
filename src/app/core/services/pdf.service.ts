import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts, LineCapStyle, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PageViewport } from 'pdfjs-dist';
import { getPdfjs } from '../pdf/pdfjs-loader';

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PageText {
  page: number;
  text: string;
}

export interface WatermarkOptions {
  text: string;
  opacity: number;
  fontSize: number;
  rotation: number;
  color: { r: number; g: number; b: number };
}

export interface PageNumberOptions {
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right';
  fontSize: number;
  startAt: number;
  margin: number;
  format: 'n' | 'n-of-total' | 'page-n';
}

/** 0–1 RGB colour used by the editing engine. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * A single edit overlay to burn into a PDF. All geometry is expressed in
 * **display points at scale 1** — i.e. pdf.js viewport coordinates with the
 * origin at the top-left and y growing downward. The engine converts these to
 * PDF user space (bottom-left origin) per page via pdf.js, so placement stays
 * correct regardless of a page's intrinsic rotation.
 */
export type EditAnnotation =
  | {
      kind: 'text';
      page: number;
      x: number;
      y: number;
      w: number;
      text: string;
      fontSize: number;
      color: Rgb;
      bold?: boolean;
      italic?: boolean;
      font?: 'sans' | 'serif' | 'mono';
      lineHeight?: number;
    }
  | {
      kind: 'rect';
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: Rgb;
      fillOpacity?: number;
      stroke?: Rgb;
      strokeWidth?: number;
    }
  | { kind: 'line'; page: number; x1: number; y1: number; x2: number; y2: number; color: Rgb; width: number }
  | { kind: 'pen'; page: number; points: { x: number; y: number }[]; color: Rgb; width: number }
  | { kind: 'image'; page: number; x: number; y: number; w: number; h: number; bytes: ArrayBuffer; mime: string };

/**
 * Document-processing engine for PDFs. Manipulation (merge/split/rotate/…) uses
 * pdf-lib; rasterisation and text extraction use pdf.js. All processing is local
 * to the browser — no file ever leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class PdfService {
  // ---- inspection --------------------------------------------------------
  async pageCount(bytes: ArrayBuffer): Promise<number> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  }

  async inspect(bytes: ArrayBuffer): Promise<{
    pageCount: number;
    title?: string;
    author?: string;
    encrypted: boolean;
    producer?: string;
  }> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return {
      pageCount: doc.getPageCount(),
      title: doc.getTitle() ?? undefined,
      author: doc.getAuthor() ?? undefined,
      producer: doc.getProducer() ?? undefined,
      encrypted: doc.isEncrypted,
    };
  }

  // ---- organise ----------------------------------------------------------
  /** Merge multiple PDFs into one, in the given order. */
  async merge(sources: ArrayBuffer[]): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    for (const src of sources) {
      const doc = await PDFDocument.load(src, { ignoreEncryption: true });
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    return out.save();
  }

  /**
   * Build a new PDF from the given 0-based page indices, in order. This single
   * primitive powers extract, delete, reorder and duplicate.
   */
  async selectPages(bytes: ArrayBuffer, order: number[]): Promise<Uint8Array> {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, order);
    copied.forEach((p) => out.addPage(p));
    return out.save();
  }

  /** Rotate specific pages by an absolute degree value (0/90/180/270). */
  async rotatePages(bytes: ArrayBuffer, rotations: Map<number, number>): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    doc.getPages().forEach((page, i) => {
      if (rotations.has(i)) {
        page.setRotation(degrees(((rotations.get(i) ?? 0) % 360 + 360) % 360));
      }
    });
    return doc.save();
  }

  /** Split into one PDF per range. Ranges are 1-based inclusive. */
  async splitByRanges(
    bytes: ArrayBuffer,
    ranges: { start: number; end: number }[],
  ): Promise<Uint8Array[]> {
    const results: Uint8Array[] = [];
    for (const range of ranges) {
      const order: number[] = [];
      for (let p = range.start; p <= range.end; p++) order.push(p - 1);
      results.push(await this.selectPages(bytes, order));
    }
    return results;
  }

  // ---- create ------------------------------------------------------------
  /** Create a PDF from image files (one image per page, scaled to fit). */
  async imagesToPdf(
    images: { bytes: ArrayBuffer; mime: string }[],
    opts: { pageSize: 'fit' | 'a4'; margin: number } = { pageSize: 'fit', margin: 0 },
  ): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    const A4 = { width: 595.28, height: 841.89 };
    for (const img of images) {
      let embedded;
      if (/png/.test(img.mime)) embedded = await out.embedPng(img.bytes);
      else if (/jpe?g/.test(img.mime)) embedded = await out.embedJpg(img.bytes);
      else {
        // Convert unsupported formats (webp/gif/svg) via canvas to PNG first.
        const png = await this.rasterizeImage(img.bytes, img.mime);
        embedded = await out.embedPng(png);
      }
      const { width, height } = embedded;
      if (opts.pageSize === 'a4') {
        const page = out.addPage([A4.width, A4.height]);
        const maxW = A4.width - opts.margin * 2;
        const maxH = A4.height - opts.margin * 2;
        const scale = Math.min(maxW / width, maxH / height, 1);
        const w = width * scale;
        const h = height * scale;
        page.drawImage(embedded, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h });
      } else {
        const page = out.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      }
    }
    return out.save();
  }

  // ---- annotate ----------------------------------------------------------
  async addPageNumbers(bytes: ArrayBuffer, opts: PageNumberOptions): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    pages.forEach((page, i) => {
      const n = opts.startAt + i;
      const label =
        opts.format === 'n-of-total' ? `${n} / ${total}` : opts.format === 'page-n' ? `Page ${n}` : `${n}`;
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(label, opts.fontSize);
      let x = width / 2 - textWidth / 2;
      let y = opts.margin;
      if (opts.position.endsWith('right')) x = width - textWidth - opts.margin;
      else if (opts.position.endsWith('left')) x = opts.margin;
      if (opts.position.startsWith('top')) y = height - opts.margin - opts.fontSize;
      page.drawText(label, { x, y, size: opts.fontSize, font, color: rgb(0.3, 0.3, 0.34) });
    });
    return doc.save();
  }

  async addWatermark(bytes: ArrayBuffer, opts: WatermarkOptions): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(opts.text, opts.fontSize);
      page.drawText(opts.text, {
        x: width / 2 - textWidth / 2,
        y: height / 2,
        size: opts.fontSize,
        font,
        color: rgb(opts.color.r, opts.color.g, opts.color.b),
        opacity: opts.opacity,
        rotate: degrees(opts.rotation),
      });
    }
    return doc.save();
  }

  /**
   * Burn editor overlays (text, whiteout, highlights, shapes, freehand, images)
   * into a PDF and return the new bytes. This is how a "non-editable" PDF gets
   * edited locally: existing content is covered with opaque boxes and fresh text
   * or graphics are stamped on top — all client-side, nothing leaves the device.
   */
  async applyEdits(bytes: ArrayBuffer, annotations: EditAnnotation[]): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = doc.getPages();

    // pdf.js gives us a correct display→user-space transform per page.
    const pdfjs = getPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const jsdoc = await task.promise;
    const vpCache = new Map<number, PageViewport>();
    const viewportFor = async (page: number): Promise<PageViewport> => {
      let vp = vpCache.get(page);
      if (!vp) {
        const jp = await jsdoc.getPage(page);
        vp = jp.getViewport({ scale: 1 });
        vpCache.set(page, vp);
      }
      return vp;
    };

    // Fonts are embedded lazily and reused across annotations.
    const fontCache = new Map<string, PDFFont>();
    const fontFor = async (
      bold?: boolean,
      italic?: boolean,
      family: 'sans' | 'serif' | 'mono' = 'sans',
    ): Promise<PDFFont> => {
      const key = `${family}:${bold ? 'b' : ''}${italic ? 'i' : ''}` || 'r';
      let f = fontCache.get(key);
      if (!f) {
        const fam =
          family === 'serif'
            ? {
                r: StandardFonts.TimesRoman,
                b: StandardFonts.TimesRomanBold,
                i: StandardFonts.TimesRomanItalic,
                bi: StandardFonts.TimesRomanBoldItalic,
              }
            : family === 'mono'
              ? {
                  r: StandardFonts.Courier,
                  b: StandardFonts.CourierBold,
                  i: StandardFonts.CourierOblique,
                  bi: StandardFonts.CourierBoldOblique,
                }
              : {
                  r: StandardFonts.Helvetica,
                  b: StandardFonts.HelveticaBold,
                  i: StandardFonts.HelveticaOblique,
                  bi: StandardFonts.HelveticaBoldOblique,
                };
        const std = bold && italic ? fam.bi : bold ? fam.b : italic ? fam.i : fam.r;
        f = await doc.embedFont(std);
        fontCache.set(key, f);
      }
      return f;
    };

    try {
      for (const a of annotations) {
        const page = pages[a.page - 1];
        if (!page) continue;
        const vp = await viewportFor(a.page);
        const map = (x: number, y: number) => {
          const [ux, uy] = vp.convertToPdfPoint(x, y);
          return { x: ux, y: uy };
        };
        if (a.kind === 'rect') {
          await this.drawEditRect(page, map, a);
        } else if (a.kind === 'line') {
          const s = map(a.x1, a.y1);
          const e = map(a.x2, a.y2);
          page.drawLine({ start: s, end: e, thickness: a.width, color: rgb(a.color.r, a.color.g, a.color.b), lineCap: LineCapStyle.Round });
        } else if (a.kind === 'pen') {
          const col = rgb(a.color.r, a.color.g, a.color.b);
          for (let i = 1; i < a.points.length; i++) {
            page.drawLine({ start: map(a.points[i - 1].x, a.points[i - 1].y), end: map(a.points[i].x, a.points[i].y), thickness: a.width, color: col, lineCap: LineCapStyle.Round });
          }
        } else if (a.kind === 'image') {
          const img = /png/i.test(a.mime)
            ? await doc.embedPng(a.bytes)
            : /jpe?g/i.test(a.mime)
              ? await doc.embedJpg(a.bytes)
              : await doc.embedPng(await this.rasterizeImage(a.bytes, a.mime));
          const p1 = map(a.x, a.y);
          const p2 = map(a.x + a.w, a.y + a.h);
          page.drawImage(img, {
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y),
          });
        } else {
          await this.drawEditText(page, map, vp.rotation, await fontFor(a.bold, a.italic, a.font), a);
        }
      }
    } finally {
      await task.destroy();
    }
    return doc.save();
  }

  private async drawEditRect(
    page: PDFPage,
    map: (x: number, y: number) => { x: number; y: number },
    a: Extract<EditAnnotation, { kind: 'rect' }>,
  ): Promise<void> {
    const p1 = map(a.x, a.y);
    const p2 = map(a.x + a.w, a.y + a.h);
    page.drawRectangle({
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
      color: a.fill ? rgb(a.fill.r, a.fill.g, a.fill.b) : undefined,
      opacity: a.fill ? (a.fillOpacity ?? 1) : undefined,
      borderColor: a.stroke ? rgb(a.stroke.r, a.stroke.g, a.stroke.b) : undefined,
      borderWidth: a.stroke ? (a.strokeWidth ?? 1) : undefined,
    });
  }

  private async drawEditText(
    page: PDFPage,
    map: (x: number, y: number) => { x: number; y: number },
    rotation: number,
    font: PDFFont,
    a: Extract<EditAnnotation, { kind: 'text' }>,
  ): Promise<void> {
    const size = a.fontSize;
    const lh = a.lineHeight ?? size * 1.2;
    const color = rgb(a.color.r, a.color.g, a.color.b);
    // Baseline of the first line, measured from the box top (approximates the
    // CSS line box so on-screen and exported text line up closely).
    const firstBaseline = size * 0.8 + (lh - size) / 2;
    const lines = a.text.split('\n').flatMap((para) => this.wrapTextToWidth(sanitizeWinAnsi(para), font, size, a.w));
    lines.forEach((line, k) => {
      const anchor = map(a.x, a.y + firstBaseline + k * lh);
      page.drawText(line, { x: anchor.x, y: anchor.y, size, font, color, rotate: degrees(rotation) });
    });
  }

  /** Greedy word-wrap to a max width (in points), matching the on-screen box. */
  private wrapTextToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    if (text === '') return [''];
    const safeMax = Math.max(maxWidth, size);
    const out: string[] = [];
    for (const word of text.split(/(\s+)/)) {
      if (word === '') continue;
      const tentative = (out.length ? out[out.length - 1] : '') + word;
      if (out.length && font.widthOfTextAtSize(tentative, size) <= safeMax) {
        out[out.length - 1] = tentative;
      } else if (!out.length && /^\s+$/.test(word)) {
        continue; // skip leading whitespace on a fresh line
      } else if (font.widthOfTextAtSize(word, size) <= safeMax) {
        out.push(word.replace(/^\s+/, ''));
      } else {
        // A single token longer than the line: hard-break it per character.
        let chunk = out.length ? out[out.length - 1] : '';
        if (!out.length) out.push('');
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= safeMax) chunk += ch;
          else { out[out.length - 1] = chunk; chunk = ch; out.push(chunk); }
        }
        out[out.length - 1] = chunk;
      }
    }
    return out.length ? out : [''];
  }

  /** Re-save the PDF, dropping unused objects. A conservative "optimise". */
  async resave(bytes: ArrayBuffer): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.save({ useObjectStreams: true });
  }

  // ---- rasterise & text (pdf.js) ----------------------------------------
  async renderPages(
    bytes: ArrayBuffer,
    scale = 1.5,
    pageNumbers?: number[],
    format: 'image/png' | 'image/jpeg' = 'image/png',
    quality = 0.92,
  ): Promise<RenderedPage[]> {
    const pdfjs = getPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const pdf = await task.promise;
    const nums = pageNumbers ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const out: RenderedPage[] = [];
    for (const n of nums) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      out.push({
        pageNumber: n,
        dataUrl: canvas.toDataURL(format, quality),
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
    }
    await task.destroy();
    return out;
  }

  async extractText(bytes: ArrayBuffer): Promise<PageText[]> {
    const pdfjs = getPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const pdf = await task.promise;
    const out: PageText[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+\n/g, '\n');
      out.push({ page: n, text });
      page.cleanup();
    }
    await task.destroy();
    return out;
  }

  // ---- helpers -----------------------------------------------------------
  /** Rasterise any browser-decodable image to PNG bytes via a canvas. */
  private async rasterizeImage(bytes: ArrayBuffer, mime: string): Promise<ArrayBuffer> {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
      const img = await this.loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1000;
      canvas.height = img.naturalHeight || 1000;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!pngBlob) throw new Error('Could not rasterise image');
      return await pngBlob.arrayBuffer();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
  }

  // ---- blob helpers ------------------------------------------------------
  toBlob(bytes: Uint8Array, type = 'application/pdf'): Blob {
    return new Blob([bytes as BlobPart], { type });
  }
}

/**
 * The StandardFonts only cover WinAnsi. Replace code points they cannot encode
 * with "?" so stamping never throws on pasted Unicode (real non-Latin text needs
 * an embedded font — flagged as a backend/font concern in the editor UI).
 */
function sanitizeWinAnsi(text: string): string {
  const gaps = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    out += code <= 0xff && !gaps.has(code) ? ch : '?';
  }
  return out;
}
