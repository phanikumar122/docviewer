# DocuFlow PDF engine (optional backend)

A small **local** service that powers DocuFlow's engine-backed tools:

- **True in-place find & replace** — removes matched glyphs and re-inserts the
  replacement (not a cover box).
- **Password protect / unlock** — AES-256 encryption with permissions, and
  password removal (pdf-lib can't encrypt, so this needs the engine).
- **PDF → Word** — editable `.docx` (or legacy `.doc`) via `pdf2docx` with layout,
  tables, headings, and images; robust PyMuPDF fallback ensures conversions never fail.
- **Word → PDF** — high-fidelity render via headless Chrome + semantic HTML (`mammoth`)
  with styled tables, headings, and lists; automatic ReportLab fallback; supports `.docx`, `.doc`, and RTF.
- **Excel ⇄ PDF** — `.xlsx` → PDF (openpyxl + reportlab, grid/merges) and PDF
  tables → `.xlsx` (PyMuPDF `find_tables`).
- **PowerPoint → PDF** — high-fidelity slide deck generation with accurate slide dimensions,
  custom fonts, colors, shapes, and tables via headless Chrome & ReportLab; supports `.pptx` and `.ppt`.
- **PDF → PowerPoint** — crisp 200 DPI slide generation with native editable text overlays
  preserving positioning, fonts, and colors (`.pptx` / `.ppt`).
- **OCR** — make a scanned PDF searchable (Tesseract via PyMuPDF); pages that
  already have text are kept, image pages get an invisible text layer.
- **Reflow** — rewrite a whole paragraph and re-wrap it inside its box.
- **Presentation editing** — read a `.pptx`'s text outline, then apply text
  edits + slide delete/reorder.

- Engine: [PyMuPDF](https://pymupdf.readthedocs.io/) + pdf2docx + reportlab. No
  LibreOffice / system packages required.
- Binds to `127.0.0.1:8787` only. Files are processed in memory and handed
  straight back — **nothing is stored and nothing leaves the machine.**
- Entirely optional: the browser-only tools work without it.

## Run

```bash
cd server
./run.sh          # first run creates .venv and installs deps, then serves
# or, from the project root:
pnpm engine
```

Then in the app open **Edit PDF → Find & replace**, tick **Server engine**
(the status dot turns green), type your find/replace and hit **Replace in
document**. The edited PDF re-opens in the editor; download it or **Save** to
overwrite the library original.

## API

| Method | Path           | Body                                                  | Response |
|--------|----------------|-------------------------------------------------------|----------|
| GET    | `/api/health`  | —                                                     | `{ ok, engine, version, features }` |
| POST   | `/api/replace` | multipart: `file` (pdf) + `options` (JSON)            | edited `application/pdf`; `X-Matches`, `X-Pages` |
| POST   | `/api/protect` | `file` (pdf) + `options` `{userPassword, ownerPassword?, allowPrint?, allowCopy?, allowModify?}` | encrypted `application/pdf`; `X-Encrypted` |
| POST   | `/api/unlock`  | `file` (pdf) + `options` `{password}`                 | decrypted `application/pdf`; `X-Was-Encrypted` (400 on wrong password) |
| POST   | `/api/pdf-to-word` | `file` (pdf) + `options` `{password?, format?}`   | `.docx` or `.doc`                      |
| POST   | `/api/word-to-pdf` | `file` (docx / doc / rtf)                         | `application/pdf`                      |
| POST   | `/api/excel-to-pdf` | `file` (xlsx)                                    | `application/pdf`                      |
| POST   | `/api/pdf-to-excel` | `file` (pdf)                                     | `.xlsx`; `X-Tables` (tables found)     |
| POST   | `/api/ppt-to-pdf`  | `file` (pptx / ppt)                               | `application/pdf`                      |
| POST   | `/api/pdf-to-ppt`  | `file` (pdf)                                       | `.pptx` (high-res slides + textboxes)  |
| POST   | `/api/ocr`         | `file` (pdf) + `options` `{language?}`             | searchable `application/pdf`; `X-Ocr-Pages` |
| POST   | `/api/reflow`      | `file` (pdf) + `options` `{edits:[{page,rect,text,fontSize?,font?,align?}]}` | `application/pdf` |
| POST   | `/api/pptx-outline`| `file` (pptx)                                      | JSON `{slides:[{index,paras:[{id,text}]}]}` |
| POST   | `/api/pptx-apply`  | `file` (pptx) + `options` `{edits:[{id,text}],delete:[i],order:[i]}` | `.pptx` |

`replace` options:

```json
{ "find": "Acme", "replace": "Globex", "matchCase": false, "wholeWord": false }
```

## How it works

For every **text span** (a run of same-style text, usually a whole line) that
contains the term, the engine redacts the entire span and re-inserts its text
with the substitution applied *inline*. Because the whole span is re-laid-out in
one pass, the characters after the match flow naturally after the replacement —
a longer or shorter replacement no longer collides with, or leaves a gap before,
the following text. The replacement is drawn in the Base-14 face that best
matches the original span's family (sans / serif / mono), weight and slant, and
keeps the original colour and size, so the line's look is preserved. Matches that
straddle two spans fall back to a stamp at the match origin.

## Notes & limits

- Replacement glyphs come from the Base-14 fonts (Helvetica / Times / Courier,
  with bold & italic). The engine picks the closest match to the original, but
  glyphs those fonts can't encode (most non-Latin scripts) are dropped —
  embedding a Unicode font is a possible follow-up. A span re-rendered this way
  uses the matched Base-14 face, so a document set in an unusual font will show
  the edited line(s) in the nearest standard face.
- This is targeted find & replace, **not** full document reflow. It re-flows the
  text *within* each matched line, but does not re-wrap the surrounding
  paragraph. For free paragraph re-editing you'd convert PDF→DOCX with
  LibreOffice/OnlyOffice, which is a heavier, lossier round-trip.
- The port is overridable in the browser via `window.DOCUFLOW_ENGINE_URL`.
