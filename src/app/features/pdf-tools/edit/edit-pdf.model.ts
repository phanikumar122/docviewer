/**
 * UI model for the PDF editor overlay. All geometry is stored in **display
 * points at scale 1** (pdf.js viewport space: top-left origin, y-down), so it is
 * zoom-independent and maps cleanly both to CSS (multiply by scale) and to the
 * export engine (PdfService.applyEdits converts to PDF user space per page).
 */
export type EditTool = 'select' | 'text' | 'whiteout' | 'highlight' | 'rect' | 'line' | 'pen' | 'image';

/** Generic font family a text annotation renders in (matched from the source
 *  text when editing existing PDF text; defaults to sans elsewhere). */
export type TextFont = 'sans' | 'serif' | 'mono';

export interface Pt {
  x: number;
  y: number;
}

interface AnnBase {
  id: string;
  /** 1-based page number. */
  page: number;
}

export interface TextAnn extends AnnBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  /** Generic family; omitted means sans. */
  font?: TextFont;
}

/** CSS font-family stack for a generic family, chosen to be metric-close to the
 *  Base-14 face the export embeds (Helvetica / Times / Courier). */
export function fontFamilyCss(font: TextFont | undefined): string {
  return font === 'serif'
    ? '"Times New Roman", Times, Georgia, "DejaVu Serif", serif'
    : font === 'mono'
      ? '"Courier New", Courier, "Liberation Mono", Menlo, Consolas, monospace'
      : 'Helvetica, Arial, "Liberation Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
}

/** whiteout (opaque cover), highlight (translucent fill) and rect (outline). */
export interface BoxAnn extends AnnBase {
  type: 'whiteout' | 'highlight' | 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
  strokeWidth: number;
}

export interface LineAnn extends AnnBase {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface PenAnn extends AnnBase {
  type: 'pen';
  points: Pt[];
  color: string;
  width: number;
}

export interface ImageAnn extends AnnBase {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  dataUrl: string;
  mime: string;
  bytes: ArrayBuffer;
}

export type Ann = TextAnn | BoxAnn | LineAnn | PenAnn | ImageAnn;

export type BoxLike = TextAnn | BoxAnn | ImageAnn;

export function isBoxLike(a: Ann): a is BoxLike {
  return a.type === 'text' || a.type === 'whiteout' || a.type === 'highlight' || a.type === 'rect' || a.type === 'image';
}

/** Hex (#rrggbb) → 0–1 RGB for pdf-lib. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
