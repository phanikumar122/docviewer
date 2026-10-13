# DocuFlow — All-in-One Document Workspace

DocuFlow is a premium, dark-first document productivity web app built with **Angular 22**.
It combines a universal file library, document viewers, in-browser PDF tools, an image
converter and a document editor into one cohesive workspace. **All processing happens
locally in your browser** — files are stored in IndexedDB and never uploaded to a server.

![stack](https://img.shields.io/badge/Angular-22-dd0031) ![tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![pnpm](https://img.shields.io/badge/pnpm-11-f69220)

## Quick start

```bash
pnpm install
pnpm start          # dev server on http://localhost:4200
```

Other scripts:

```bash
pnpm build          # production build  -> dist/docuflow
pnpm test           # unit tests (Vitest)
pnpm e2e            # end-to-end smoke tests (Playwright)
                    #   first time: pnpm exec playwright install chromium
```

> Requires Node ≥ 22 and pnpm. On first run the app seeds a few **real demo documents**
> (generated PDFs, Markdown, CSV, JSON, SVG) so every viewer and tool is immediately usable.
> Demo files are marked with a dot and can be cleared from **Settings → Delete all data**.

## Technology

Angular 22 (standalone, **zoneless**, signals) · Angular Router (lazy routes, view transitions) ·
Tailwind CSS v4 · Angular CDK (drag-drop) · Apache ECharts · GSAP · Lucide icons ·
IndexedDB (`idb`) · PDF.js (render/text) · pdf-lib (manipulation) · mammoth (DOCX→HTML) ·
SheetJS (XLSX) · marked + DOMPurify (safe Markdown/HTML) · Vitest · Playwright.

## What's implemented (and genuinely works)

**Shell & platform**
- Collapsible sidebar, responsive top bar, global search, **command palette (⌘/Ctrl-K)**
- Clean light theme, reduced-motion aware
- Toasts, confirm dialogs, animated upload progress, library file-picker
- IndexedDB persistence for file metadata, blobs, activity, editor drafts and settings

**Dashboard** — greeting, drag-drop upload, stats, file-type breakdown (ECharts donut),
recent & starred documents, quick tools, recent activity, GSAP staggered reveal.

**File manager** — grid/list views, search, type filters, sort, folders & nested folders,
multi-select + bulk actions, rename, move, duplicate, star, **Trash with restore / delete**,
context menus, drag-drop upload, file details panel. All metadata persists in IndexedDB.

**Universal viewer** — adapts to the file type:
- **PDF** (PDF.js): page nav, zoom, fit width/page, rotate, thumbnails, selectable text layer,
  in-document text search, print, download, fullscreen, properties/encryption inspection
- **Images**: zoom, rotate; SVG rendered **sanitised**
- **DOCX** (mammoth → sanitised HTML, read-only)
- **XLSX/XLS/ODS** (SheetJS) with sheet tabs
- **Text / Markdown (rendered) / JSON / CSV (table) / XML**
- Clear "no preview" + download fallback for unsupported types

**PDF tools** (all local, real output): Merge · Split (per-page / ranges / fixed chunks) ·
Organize (drag-reorder, duplicate, delete pages) · Rotate · Images→PDF · PDF→Images ·
PDF→Text · Add page numbers · Add watermark · Compress (lossless re-save).

**Image tools** — in-browser PNG/JPEG/WEBP converter with quality control.

**Editor** — rich-text editor (headings, bold/italic/underline/strike, lists, alignment,
links, undo/redo) for Word/new documents, and a code editor for text/Markdown/JSON/XML with
live Markdown preview. **Autosave** (text files write back; rich docs keep a draft), unsaved-change
warning, and export to HTML / Markdown / plain text into the library.

**Settings** — storage usage, privacy explanation, and data management
(clear activity, empty trash, delete all data).

## Optional local engine: true in-place PDF text editing (`server/`)

The browser **Edit PDF → Find & replace** works with no backend: it covers each
match with an opaque box and stamps the new text on top (now across split text
runs, with glyph-accurate positions). The original glyphs still exist in the file.

For a **true** in-place edit — the matched glyphs removed from the page and the
replacement re-inserted at the same baseline — run the optional local engine
([PyMuPDF](https://pymupdf.readthedocs.io/)):

```bash
pnpm engine          # = bash server/run.sh — first run sets up server/.venv
```

Then tick **Server engine** in the Find & replace panel. It binds to
`127.0.0.1:8787` only and processes in memory, so the PDF never leaves your
machine. See `server/README.md`. (It's targeted find/replace, not full paragraph
reflow — that still needs an office round-trip; see below.)

## Local engine (optional, bundled) — `server/`

These run in the bundled local engine (`pnpm engine`, binds to `127.0.0.1`,
files never leave your device). Each tool shows a status pill and a one-line
start hint when the engine is off:

- **PDF → Word** (editable `.docx` / `.doc`) and **Word → PDF** (`.docx` / `.doc` / RTF) —
  powered by headless Chrome + semantic HTML (`mammoth`) and `pdf2docx`, with automatic
  ReportLab/PyMuPDF fallbacks. Tables, headings, lists, and images preserved cleanly.
- **Excel ⇄ PDF** and **PowerPoint ⇄ PDF** (`.pptx` / `.ppt`) conversions —
  slide deck engine preserving layouts, tables, and shapes; 200 DPI high-res slides with editable text overlays.
- **OCR scanned PDFs** → searchable PDF (Tesseract via PyMuPDF).
- **Paragraph reflow** in Edit PDF — rewrite a paragraph and re-wrap it in place.
- **Edit Presentation** — edit slide text, reorder / delete slides in a `.pptx`.
- **Password protect / unlock** — AES-256 encryption with permissions, and
  password removal (pdf-lib cannot encrypt, so this needs the engine).
- **True in-place find & replace** in Edit PDF.

**Edit Spreadsheet** (Excel/CSV, editable grid) runs fully in the browser via
SheetJS — no engine needed.

## Still requires a heavier engine (honestly **not** faked)

- **XLSX / PPTX → their formats with full fidelity** editing of shape layout,
  charts and animations (we edit cell values and slide text, not graphical layout).
- Full **document reflow** across pages when editing (reflow re-wraps a single
  paragraph box, not the whole document).

The processing layer is abstracted (`PdfService`, viewer/editor components) so a server
implementation can be slotted in behind the same interfaces.

## Architecture

```
src/app/
  core/      models, services (db, library, pdf, toast, upload, confirm, file-picker), pdf loader
  shared/    reusable components (icon, page-header, empty-state, drop-zone, file-badge,
             pdf-source, tool-result, echart, spinner) + utils (format, sanitize, animate)
  layout/    shell, sidebar, topbar, command palette, hosts (toast/confirm/picker/upload)
  features/  dashboard, files, viewer (+ pdf/image/text/docx/sheet sub-viewers),
             editor, pdf-tools, converters, image-tools, settings
```

Standalone components, strict TypeScript, signals for state, lazy-loaded feature routes,
and document-processing logic kept out of UI components.

## Security & privacy

Files are treated as sensitive: processed locally, stored in IndexedDB (never localStorage),
object URLs revoked after use. Untrusted HTML/SVG (DOCX previews, Markdown, SVG images) is
sanitised with DOMPurify. File size is validated (150 MB cap) and type detection does not
trust the extension alone. A "delete all data" action wipes everything from the device.

## Testing

- **Unit** (Vitest): formatting helpers and file-kind detection — `pnpm test`.
- **E2E** (Playwright): dashboard load + demo-data seeding, navigation, command palette,
  tools catalog, and opening a PDF in the viewer — `pnpm e2e`.

## Deployment

`pnpm build` produces a static bundle in `dist/docuflow/browser`. Serve it from any static
host (Netlify, Vercel, S3+CloudFront, nginx). Set a Content-Security-Policy and `Cross-Origin`
headers as appropriate; no server runtime is required for the current feature set. To enable
Office conversions / encryption / OCR, deploy a separate processing API and implement the
corresponding engine behind the existing service interfaces.

## Known limitations

- DOCX preview is structural (mammoth), not pixel-exact; complex layouts may differ.
- The rich-text editor uses `contenteditable`; it is not a full word processor.
- PDF "compress" is a lossless re-save, not image recompression.
- Spreadsheet/presentation editing and Office conversions need the backend described above.
