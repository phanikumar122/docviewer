# DocuFlow — Testing & Run Guide

This guide walks you through running **DocuFlow** and verifying that every part of it
actually works. Follow it top to bottom. No prior setup knowledge is assumed.

DocuFlow is an in-browser document workspace — by default nothing is uploaded to a server,
all files live in your browser's IndexedDB. On first launch it seeds a few **real demo
documents** so every viewer and tool is testable immediately.

> One **optional** feature — true in-place PDF text editing — can use a local engine you
> start yourself (see §8). It binds to `127.0.0.1` only, holds files in memory, and stores
> nothing. Everything else is 100% in-browser; the engine is off unless you turn it on.

---

## 1. Prerequisites

| Requirement | Version | Check with |
|-------------|---------|------------|
| Node.js    | ≥ 22 (built on v26) | `node --version` |
| pnpm       | 11.x    | `pnpm --version` |
| Browser    | Any modern Chromium / Firefox / Safari | — |

> This project uses **pnpm**, not npm. If `pnpm` is missing, install it with
> `corepack enable` (ships with Node) or `npm i -g pnpm`.

---

## 2. Install dependencies

From the project root (`/home/phani/Documents/DocViewer`):

```bash
pnpm install
```

This installs everything listed in `package.json` and reads the pinned
`pnpm-lock.yaml`. It should finish with no errors.

---

## 3. Run the app (dev server)

```bash
pnpm start
```

- Wait for the line `➜ Local: http://localhost:4200/`.
- Open **http://localhost:4200** in your browser.
- Stop the server any time with `Ctrl-C`.

**✅ Pass:** the dashboard loads with a greeting, stats, a file-type donut chart, and a few
demo documents already present.

---

## 4. Production build

```bash
pnpm build
```

**✅ Pass:** exits with code `0` and writes the static bundle to `dist/docuflow/browser`.
A bundle-size budget warning is fine; an **error** is not.

To preview the production build like a real static deploy:

```bash
pnpm dlx http-server dist/docuflow/browser -p 8080
# then open http://localhost:8080
```

---

## 5. Automated tests

Run these to confirm the core logic is healthy before manual testing.

```bash
pnpm test     # unit tests (Vitest)   — expect all passing
pnpm e2e      # end-to-end (Playwright) — expect all passing
```

> **First e2e run only**, install the browser once:
> ```bash
> pnpm exec playwright install chromium
> ```

**✅ Pass:** both commands finish green. The e2e suite covers dashboard load + demo-data
seeding, navigation, the command palette, the tools catalog, and opening a PDF.

---

## 6. Manual test checklist

Do these in the running app (`pnpm start`). Each item is "do X → expect Y".

### Shell & navigation
- [ ] Sidebar collapses/expands and every nav link routes correctly.
- [ ] Press **⌘K / Ctrl-K** → command palette opens; type and jump to a page.

### Dashboard
- [ ] Stats, the file-type **donut chart**, recent & starred documents render.
- [ ] Drag a file from your desktop onto the dashboard → upload progress → file appears.

### File manager (**Files**)
- [ ] Switch grid/list, search, filter by type, and sort.
- [ ] Create a folder, move a file into it, rename, duplicate, and star a file.
- [ ] Select multiple files → bulk action works.
- [ ] Delete a file → it lands in **Trash** → restore it → it comes back.
- [ ] Reload the page → everything persists (it's in IndexedDB).

### Universal viewer (click a demo file to open)
- [ ] **PDF**: page nav, zoom, fit width/page, rotate, thumbnails, select text, in-doc
      search, print, download, fullscreen.
- [ ] **Image / SVG**: zoom + rotate (SVG renders sanitized).
- [ ] **DOCX**: opens read-only via mammoth.
- [ ] **XLSX / CSV**: table renders, sheet tabs switch.
- [ ] **Markdown / JSON / XML / Text**: render correctly.

### PDF tools (**Tools**) — all produce a real downloadable result
- [ ] **Merge** two PDFs into one.
- [ ] **Split** by per-page / ranges / fixed chunks.
- [ ] **Organize**: drag to reorder, duplicate, and delete pages.
- [ ] **Rotate**, **Images→PDF**, **PDF→Images**, **PDF→Text**.
- [ ] **Add page numbers**, **Add watermark**, **Compress** (lossless re-save).

### Edit PDF — change existing content (see §7 for the full how-to)
- [ ] Open **Edit PDF** (viewer toolbar button, sidebar nav, or `/tools/edit`).
- [ ] **Whiteout + text box**: cover locked text, retype on top → export → the change is burned in.
- [ ] **Find & Replace** panel (`replace` button): replace a word that appears in the demo PDF →
      old glyphs are covered, replacement stamped on top.
- [ ] Text box / highlight / rectangle / line / pen / insert image & signature all add and export.
- [ ] Undo/redo, per-page clear, and keyboard (Del / Ctrl-Z / Ctrl-Shift-Z / Esc) work.

### Image tools
- [ ] Convert an image between PNG / JPEG / WEBP with a quality slider.

### Editor
- [ ] Rich-text: headings, bold/italic/underline, lists, alignment, links, undo/redo.
- [ ] Code editor (Markdown/JSON/XML) shows live Markdown preview.
- [ ] **Autosave** works; leaving with unsaved changes warns you.
- [ ] Export to HTML / Markdown / plain text saves back into the library.

### Settings
- [ ] Storage usage shows a real number.
- [ ] Clear activity, empty trash, and **Delete all data** each work (the last wipes
      everything and re-seeds demo files on next load).

---

## 7. Editing existing PDF content

PDFs don't store editable "documents" — text is baked into the page. DocuFlow gives you
**two ways** to change existing content, depending on how real you need the edit to be.

### A. Browser-only (default, no setup)

Open the **Edit PDF** tool — the `Edit PDF` button in the PDF viewer toolbar, the sidebar
nav entry, or go to `/tools/edit` (or `/tools/edit/:id` for a file already in your library).

- **Find & Replace** (toolbar `replace` button) — type the text to find and its replacement.
  It scans every page with pdf.js, matches **across split runs** with glyph-accurate boxes,
  covers the old glyphs with whiteout, and stamps the replacement on top. Leave the
  replacement blank to **redact** (cover only). Closest thing to in-place editing with no setup.
- **Manual whiteout + text box** — draw a whiteout cover over the locked text, add a text box
  on top, and retype. Best for one-off tweaks. Also available: highlight, rectangle, line,
  freehand pen, and insert image / signature.

Click **Export** to burn the overlays into a fresh PDF, or **Save** to overwrite the library original.

> **How this actually works:** the browser path *covers and restamps* — it does not rewrite
> the PDF's text runs. The original glyphs still exist underneath the white cover, so text
> extraction or copy-paste can still surface them. Fonts are StandardFonts/WinAnsi only, so
> non-Latin characters are sanitized to `?`. Rotated / scanned text won't match in Find & Replace.
> For a true removal, use path B.

### B. True in-place edit (optional local engine)

If you need the old text **actually removed** from the file (not covered), start the local
engine (§8), then in the Edit PDF Find & Replace panel tick **"Server engine"** (the status
dot shows running / offline). The button changes to **"Replace in document"** — the file is
sent to your local engine, which removes the matched glyphs via redactions and re-inserts
the replacement at the original baseline and size, then re-opens the edited result. Export /
Save then persist that server edit. Replacement font is Helvetica; non-Latin glyphs may drop.

### What neither path does

Full **re-typing inside existing text runs with paragraph reflow** (like a word processor) is
**not** implemented — that needs a LibreOffice / OnlyOffice round-trip, which wrecks layout
on PDF→DOCX→PDF and is deliberately skipped. Both paths above are targeted edits, not reflow.

---

## 8. Optional local PDF engine (for true in-place text edit)

This is the only non-browser feature, and it's **optional** — the app is fully usable without it.
It's a local Flask + **PyMuPDF** service used only for path B above.

```bash
pnpm engine
```

- **First run** builds a Python virtualenv at `server/.venv` (via `uv` or `pip`) and then serves.
  No system packages or `sudo` needed.
- Serves on **http://127.0.0.1:8787** only — localhost-bound, in-memory, stores nothing.
- Leave it running in its own terminal; use the app as normal and toggle **Server engine** in
  the Edit PDF panel. Stop it with `Ctrl-C`.

**✅ Pass:** `pnpm engine` prints that it's serving on `127.0.0.1:8787`; in the Edit PDF panel
the engine status dot turns to **running**; a "Replace in document" run reports matches replaced
and the edited PDF re-opens with the old text genuinely gone.

Endpoints (for reference): `GET /api/health` → `{ok,engine,version}`; `POST /api/replace`
(multipart `file` + `options` JSON) → edited `application/pdf`. CORS allows localhost origins only.

> If `server/.venv` doesn't exist, the engine-mode e2e test (`e2e/engine.spec.ts`) **skips**
> cleanly rather than failing — the engine is optional.

---

## 9. Expected "not a bug" items

**Now available via the local engine** (`pnpm engine`): PDF→Word, Word→PDF,
Excel⇄PDF, PowerPoint⇄PDF, OCR (searchable scanned PDFs), password protect/unlock,
paragraph **reflow** in Edit PDF, and **Edit Presentation** (slide text + reorder/
delete). **Edit Spreadsheet** (Excel/CSV grid) runs in the browser, no engine.
Each engine tool shows a status pill; when the engine is off they prompt you to
start it rather than failing silently.

Still intentionally **not** implemented — do **not** report as failures:

- Graphical **layout** editing of spreadsheets/slides (we edit cell values and
  slide text, not shape positions, charts or animations).
- Full multi-page document **reflow** (reflow re-wraps one paragraph box).

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pnpm: command not found` | `corepack enable` or `npm i -g pnpm` |
| Port 4200 already in use | `pnpm start -- --port 4300` |
| PDF viewer blank | Confirm `pdf.worker.min.mjs` is served (it's copied to the app root by the build); hard-refresh. |
| e2e fails to launch a browser | Run `pnpm exec playwright install chromium` once. |
| Weird state after testing | **Settings → Delete all data**, then reload. |
| "Server engine" stays **offline** | Start it with `pnpm engine` in a separate terminal; confirm it's serving on `127.0.0.1:8787`. The browser cover+restamp still works without it. |

---

**Quick summary for a reviewer:**

```bash
pnpm install        # 1. deps
pnpm test           # 2. unit tests  (green)
pnpm e2e            # 3. e2e tests    (green)  — first time: pnpm exec playwright install chromium
pnpm start          # 4. run → http://localhost:4200  → walk section 6 checklist
pnpm build          # 5. prod build   (exit 0)
pnpm engine         # 6. OPTIONAL — local PDF engine for true in-place text edit (§8)
```
