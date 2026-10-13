"""
DocuFlow PDF engine — a small local backend for TRUE in-place PDF text editing.

Unlike the browser's cover-&-restamp (which paints an opaque box over the old
glyphs and stamps new text on top, leaving the original text still present in the
file), this service uses PyMuPDF redactions to *remove* the matched glyphs from
the page content stream and re-insert the replacement text at the same baseline.
The rest of the page — graphics, images, other text — is left untouched, so the
layout is preserved far better than a PDF→DOCX→PDF round-trip would manage.

Runs on 127.0.0.1 only (never exposed to the network) and keeps nothing: each
request is processed in memory and the bytes are returned to the caller. The file
never leaves your machine.
"""

from __future__ import annotations

import io
import json
import os
import re
import tempfile

import pymupdf as fitz  # PyMuPDF (the `fitz` alias is the historical module name)
from flask import Flask, Response, jsonify, request

app = Flask(__name__)

MAX_UPLOAD = 100 * 1024 * 1024  # 100 MB
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD

# The app may run on any localhost port (dev server, preview, e2e). Since the
# engine is bound to loopback anyway, allow any loopback origin — but nothing
# else, so a page on the public internet can't reach a user's local engine.
_LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


def _origin_allowed(origin: str) -> bool:
    return bool(_LOCAL_ORIGIN.match(origin))


@app.after_request
def cors(resp: Response) -> Response:
    origin = request.headers.get("Origin", "")
    if _origin_allowed(origin):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def _has(mod: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(mod) is not None


def _tesseract_ok() -> bool:
    """OCR needs the Tesseract engine reachable by PyMuPDF (it shells out)."""
    import shutil

    return shutil.which("tesseract") is not None


def find_chrome() -> str | None:
    """Find a usable Chrome or Chromium binary for high-fidelity HTML printing."""
    import glob
    import shutil

    candidates = [
        shutil.which("google-chrome-stable"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("brave-browser"),
        shutil.which("chrome"),
    ]
    pw_matches = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome"))
    if pw_matches:
        candidates.extend(pw_matches)
    pw_shell = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux64/headless_shell"))
    if pw_shell:
        candidates.extend(pw_shell)

    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def print_html_to_pdf(html: str) -> bytes | None:
    """Render HTML string to PDF using headless Chrome/Chromium."""
    chrome = find_chrome()
    if not chrome:
        return None
    try:
        import subprocess

        with tempfile.TemporaryDirectory() as d:
            h_path = os.path.join(d, "doc.html")
            out_path = os.path.join(d, "out.pdf")
            with open(h_path, "w", encoding="utf-8") as f:
                f.write(html)
            proc = subprocess.run(
                [
                    chrome,
                    "--headless",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--no-pdf-header-footer",
                    f"--print-to-pdf={out_path}",
                    f"file://{h_path}",
                ],
                capture_output=True,
                check=False,
                timeout=35,
            )
            if proc.returncode == 0 and os.path.isfile(out_path) and os.path.getsize(out_path) > 300:
                with open(out_path, "rb") as f:
                    return f.read()
    except Exception:
        pass
    return None


@app.route("/api/health", methods=["GET", "OPTIONS"])
def health() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    return jsonify(
        {
            "ok": True,
            "engine": "pymupdf",
            "version": getattr(fitz, "VersionBind", "unknown"),
            "features": {
                "replace": True,
                "protect": True,
                "unlock": True,
                "pdfToWord": True,
                "wordToPdf": _has("docx") or _has("mammoth") or _has("reportlab"),
                "excelToPdf": _has("openpyxl") and _has("reportlab"),
                "pdfToExcel": _has("openpyxl"),
                "pptToPdf": _has("pptx") or _has("reportlab"),
                "pdfToPpt": _has("pptx"),
                "ocr": _tesseract_ok(),
                "reflow": True,
                "editPptx": _has("pptx"),
            },
        }
    )


def _iter_spans(page: fitz.Page) -> list[dict]:
    """Flatten a page's text spans into dicts carrying the span text + geometry."""
    spans: list[dict] = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                bbox = fitz.Rect(span["bbox"])
                spans.append(
                    {
                        "text": span.get("text", "") or "",
                        "bbox": bbox,
                        "size": float(span.get("size", 0) or 0),
                        "color": int(span.get("color", 0) or 0),
                        "origin": span.get("origin", (bbox.x0, bbox.y1)),
                        "font": str(span.get("font", "") or ""),
                        "flags": int(span.get("flags", 0) or 0),
                    }
                )
    return spans


# Base-14 font short names PyMuPDF understands, keyed by (bold, italic).
_SANS = {(0, 0): "helv", (1, 0): "hebo", (0, 1): "heit", (1, 1): "hebi"}
_SERIF = {(0, 0): "tiro", (1, 0): "tibo", (0, 1): "tiit", (1, 1): "tibi"}
_MONO = {(0, 0): "cour", (1, 0): "cobo", (0, 1): "coit", (1, 1): "cobi"}

# PyMuPDF span flag bits.
_FLAG_ITALIC = 1 << 1
_FLAG_SERIF = 1 << 2
_FLAG_MONO = 1 << 3
_FLAG_BOLD = 1 << 4


def _pick_font(span: dict | None) -> str:
    """Choose a Base-14 font that matches the original span's family/weight/style.

    The replacement glyphs can only come from the Base-14 set (embedding the
    document's own subset font would need the missing glyph outlines), but
    picking serif-vs-sans and bold/italic from the span keeps a replacement from
    turning bold serif text into plain Helvetica — the thing that read as "broken".
    """
    if not span:
        return "helv"
    flags = span.get("flags", 0)
    name = (span.get("font") or "").lower()
    bold = bool(flags & _FLAG_BOLD) or any(
        k in name for k in ("bold", "black", "heavy", "semibold", "demi", "medium", "-b", "_b", "w7", "w8", "w9")
    )
    italic = bool(flags & _FLAG_ITALIC) or any(
        k in name for k in ("italic", "oblique", "slanted", "kursiv", "-it", "_it", "ital")
    )
    mono = bool(flags & _FLAG_MONO) or any(
        k in name for k in ("mono", "courier", "consol", "menlo", "monaco", "code", "fixed", "terminal")
    )
    serif = bool(flags & _FLAG_SERIF) or any(
        k in name for k in ("times", "serif", "roman", "georgia", "garamond", "minion", "cambria", "palatino", "baskerville", "century", "bookman")
    )
    table = _MONO if mono else _SERIF if serif else _SANS
    return table[(int(bold), int(italic))]


def _span_for(rect: fitz.Rect, spans: list[dict]) -> dict | None:
    """The span whose box contains the centre of a match rect (best overlap)."""
    center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    best, best_area = None, 0.0
    for s in spans:
        if s["bbox"].contains(center):
            inter = s["bbox"] & rect
            area = abs(inter.get_area()) if not inter.is_empty else 0.0
            if area >= best_area:
                best, best_area = s, area
    return best


def _color01(srgb: int) -> tuple[float, float, float]:
    try:
        r, g, b = fitz.sRGB_to_pdf(srgb)
        return (r, g, b)
    except Exception:
        return (0.0, 0.0, 0.0)


def _compile(find: str, match_case: bool, whole_word: bool) -> re.Pattern:
    """Build the search pattern honouring match-case / whole-word."""
    core = re.escape(find)
    if whole_word:
        core = r"(?<!\w)" + core + r"(?!\w)"
    return re.compile(core, 0 if match_case else re.IGNORECASE)


def _matches_case(page: fitz.Page, rect: fitz.Rect, needle: str) -> bool:
    """search_for is case-insensitive; re-read the box to honour match-case."""
    try:
        found = page.get_textbox(rect) or ""
    except Exception:
        return True
    return needle in found


def _fit_size(text: str, fontname: str, size: float, avail: float) -> float:
    """Shrink the font just enough to keep `text` from running off the usable
    width — only ever smaller, and never below a readable floor. Keeps a long
    replacement on the page instead of spilling into the margin."""
    if avail <= 0:
        return size
    try:
        width = fitz.get_text_length(text, fontname=fontname, fontsize=size)
    except Exception:
        return size
    if width <= avail:
        return size
    return max(size * (avail / width), 4.0)


def replace_in_pdf(
    data: bytes,
    find: str,
    replace: str,
    match_case: bool,
    whole_word: bool,
) -> tuple[bytes, int, int]:
    """Return (new_bytes, matches_replaced, pages_touched).

    Strategy — operate at the TEXT SPAN level, not the raw match rectangle. For
    every span whose text contains the term we redact the *whole* span and
    re-insert the span's text with the substitution applied inline. That way the
    characters after the match flow naturally after the replacement instead of
    the old approach's fixed-width stamp, which overlapped the following text
    whenever the replacement was a different length than the original (the bug
    that made this read as "not working"). A span's font family / weight / style
    and colour are matched to a Base-14 face so the line's look is preserved.

    Matches that straddle two spans (pdf.js/producers sometimes split a phrase)
    are picked up by a `search_for` fallback and stamped at the match origin.
    """
    pat = _compile(find, match_case, whole_word)
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        total = 0
        pages_touched = 0
        for page in doc:
            spans = _iter_spans(page)
            page_right = page.rect.x1

            # 1) Span-level substitutions (the common, high-fidelity path).
            jobs: list[tuple] = []  # (bbox, origin, size, color, font, new_text)
            for s in spans:
                new_text, n = pat.subn(lambda _m: replace, s["text"])
                if n == 0:
                    continue
                total += n
                bbox = s["bbox"]
                size = s["size"] if s["size"] > 1 else max(6.0, bbox.height * 0.8)
                jobs.append(
                    (
                        bbox,
                        s["origin"],
                        size,
                        _color01(s["color"]),
                        _pick_font(s),
                        new_text,
                    )
                )

            # 2) Cross-span phrase fallback: occurrences no single span held.
            cross: list[tuple] = []  # (rect, span-or-None)
            try:
                hits = page.search_for(find, quads=False)
            except Exception:
                hits = []
            for rect in hits:
                center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
                if any(b.contains(center) for (b, *_rest) in jobs):
                    continue  # already handled above
                if match_case and not _matches_case(page, rect, find):
                    continue
                if whole_word:
                    box = page.get_textbox(fitz.Rect(rect.x0 - 2, rect.y0, rect.x1 + 2, rect.y1)) or ""
                    if not pat.search(box):
                        continue
                cross.append((rect, _span_for(rect, spans)))

            if not jobs and not cross:
                continue

            # Remove the originals (text only — keep images and vector art).
            for bbox, *_ in jobs:
                page.add_redact_annot(bbox, fill=None)
            for rect, _ in cross:
                page.add_redact_annot(rect, fill=None)
            page.apply_redactions(
                images=getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0),
                graphics=getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0),
            )

            # Re-insert span-level text with the replacement flowed inline.
            for bbox, origin, size, color, font, new_text in jobs:
                avail = page_right - origin[0] - 4
                fs = _fit_size(new_text, font, size, avail)
                try:
                    page.insert_text(
                        (origin[0], origin[1]), new_text,
                        fontsize=fs, color=color, fontname=font,
                    )
                except Exception:
                    pass

            # Stamp cross-span replacements at the match origin.
            if replace:
                for rect, span in cross:
                    total += 1
                    size = span["size"] if span and span["size"] > 1 else max(6.0, rect.height * 0.72)
                    color = _color01(span["color"]) if span else (0.0, 0.0, 0.0)
                    font = _pick_font(span) if span else "helv"
                    baseline_y = span["origin"][1] if span else rect.y1 - rect.height * 0.2
                    avail = page_right - rect.x0 - 4
                    fs = _fit_size(replace, font, size, avail)
                    try:
                        page.insert_text(
                            (rect.x0, baseline_y), replace,
                            fontsize=fs, color=color, fontname=font,
                        )
                    except Exception:
                        pass
            else:
                total += len(cross)

            pages_touched += 1
        out = doc.tobytes(deflate=True, garbage=3)
        return out, total, pages_touched
    finally:
        doc.close()


@app.route("/api/replace", methods=["POST", "OPTIONS"])
def replace() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)

    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "No PDF uploaded (field 'file')."}), 400

    opts_raw = request.form.get("options", "{}")
    try:
        opts = json.loads(opts_raw)
    except json.JSONDecodeError:
        return jsonify({"error": "Bad 'options' JSON."}), 400

    find = str(opts.get("find", ""))
    if not find:
        return jsonify({"error": "'find' is required."}), 400
    replace_with = str(opts.get("replace", ""))
    match_case = bool(opts.get("matchCase", False))
    whole_word = bool(opts.get("wholeWord", False))

    data = upload.read()
    if not data:
        return jsonify({"error": "Empty file."}), 400

    try:
        out, matches, pages = replace_in_pdf(data, find, replace_with, match_case, whole_word)
    except Exception as exc:  # noqa: BLE001 — report any engine failure to the client
        return jsonify({"error": f"Engine error: {exc}"}), 500

    resp = Response(io.BytesIO(out).read(), mimetype="application/pdf")
    resp.headers["X-Matches"] = str(matches)
    resp.headers["X-Pages"] = str(pages)
    resp.headers["Access-Control-Expose-Headers"] = "X-Matches, X-Pages"
    return resp


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _pdf_resp(data: bytes, extra: dict | None = None) -> Response:
    resp = Response(data, mimetype="application/pdf")
    for k, v in (extra or {}).items():
        resp.headers[k] = str(v)
    if extra:
        resp.headers["Access-Control-Expose-Headers"] = ", ".join(extra)
    return resp


def _read_upload() -> tuple[bytes | None, dict, Response | None]:
    upload = request.files.get("file")
    if upload is None:
        return None, {}, (jsonify({"error": "No file uploaded (field 'file')."}), 400)
    try:
        opts = json.loads(request.form.get("options", "{}"))
    except json.JSONDecodeError:
        return None, {}, (jsonify({"error": "Bad 'options' JSON."}), 400)
    data = upload.read()
    if not data:
        return None, {}, (jsonify({"error": "Empty file."}), 400)
    return data, opts, None


def _permissions(opts: dict) -> int:
    """Full permissions minus whatever the request opts out of."""
    perm = (
        fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ
        | fitz.PDF_PERM_COPY | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_FORM
        | fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ASSEMBLE
    )
    if not opts.get("allowPrint", True):
        perm &= ~(fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ)
    if not opts.get("allowCopy", True):
        perm &= ~fitz.PDF_PERM_COPY
    if not opts.get("allowModify", True):
        perm &= ~(fitz.PDF_PERM_MODIFY | fitz.PDF_PERM_ASSEMBLE | fitz.PDF_PERM_ANNOTATE | fitz.PDF_PERM_FORM)
    return perm


@app.route("/api/protect", methods=["POST", "OPTIONS"])
def protect() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    user_pw = str(opts.get("userPassword", "") or "")
    owner_pw = str(opts.get("ownerPassword", "") or "") or user_pw
    if not user_pw and not owner_pw:
        return jsonify({"error": "A password is required."}), 400
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not open PDF: {exc}"}), 400
    try:
        if doc.needs_pass:
            return jsonify({"error": "This PDF is already password-protected. Unlock it first."}), 400
        out = doc.tobytes(
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=owner_pw,
            user_pw=user_pw,
            permissions=_permissions(opts),
            garbage=3,
            deflate=True,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Encryption failed: {exc}"}), 500
    finally:
        doc.close()
    return _pdf_resp(out, {"X-Encrypted": "1"})


@app.route("/api/unlock", methods=["POST", "OPTIONS"])
def unlock() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    password = str(opts.get("password", "") or "")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not open PDF: {exc}"}), 400
    try:
        was_encrypted = bool(doc.needs_pass)
        if doc.needs_pass:
            if not doc.authenticate(password):
                return jsonify({"error": "Wrong password."}), 400
        out = doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE, garbage=3, deflate=True)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Unlock failed: {exc}"}), 500
    finally:
        doc.close()
    return _pdf_resp(out, {"X-Was-Encrypted": "1" if was_encrypted else "0"})


def pdf_to_docx_fallback(pdf_bytes: bytes, password: str = "") -> bytes:
    """Robust fallback: construct a clean .docx with PyMuPDF extracting tables, headings, text and images."""
    import docx
    from docx.shared import Inches

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.is_encrypted:
        doc.authenticate(password or "")
    out_doc = docx.Document()

    for page_idx, page in enumerate(doc):
        if page_idx > 0:
            out_doc.add_page_break()

        # Detect and extract tables
        tables = []
        try:
            tabs = page.find_tables()
            for t in tabs:
                tables.append((t.bbox, t.extract()))
        except Exception:
            pass

        table_rects = [t[0] for t in tables]

        # Extract text blocks
        blocks = page.get_text("blocks")
        for b in blocks:
            x0, y0, x1, y1, text, block_no, b_type = b
            txt = text.strip()
            if not txt:
                continue
            # Check if block is inside an extracted table
            in_table = any(
                tb[0] <= x0 and tb[1] <= y0 and tb[2] >= x1 and tb[3] >= y1
                for tb in table_rects
            )
            if in_table:
                continue

            # Check font size of lines in this block to distinguish headings
            is_heading = False
            spans = []
            try:
                d = page.get_text("dict", clip=fitz.Rect(x0, y0, x1, y1))
                spans = [s for bl in d.get("blocks", []) if "lines" in bl for l in bl["lines"] for s in l["spans"]]
                if spans and any(s.get("size", 0) >= 16 or (s.get("flags", 0) & 16 and s.get("size", 0) >= 13) for s in spans):
                    is_heading = True
            except Exception:
                pass

            if is_heading:
                lvl = 1 if any(s.get("size", 0) >= 20 for s in spans) else 2
                out_doc.add_heading(txt, level=lvl)
            else:
                out_doc.add_paragraph(txt)

        # Insert extracted tables
        for _t_bbox, t_data in tables:
            if not t_data:
                continue
            rows = len(t_data)
            cols = max(len(r) for r in t_data) if rows else 0
            if rows and cols:
                tbl = out_doc.add_table(rows=rows, cols=cols)
                tbl.style = "Table Grid"
                for r_idx, row in enumerate(t_data):
                    for c_idx, val in enumerate(row):
                        tbl.cell(r_idx, c_idx).text = str(val or "")

        # Extract embedded images
        try:
            for img_info in page.get_images():
                xref = img_info[0]
                base_img = doc.extract_image(xref)
                if base_img and "image" in base_img:
                    img_data = base_img["image"]
                    if len(img_data) > 500:
                        out_doc.add_picture(io.BytesIO(img_data), width=Inches(4.5))
        except Exception:
            pass

    buf = io.BytesIO()
    out_doc.save(buf)
    return buf.getvalue()


@app.route("/api/pdf-to-word", methods=["POST", "OPTIONS"])
def pdf_to_word() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    password = str(opts.get("password", "") or "")

    docx_bytes = None
    # 1. Primary: Try pdf2docx
    try:
        from pdf2docx import Converter

        with tempfile.TemporaryDirectory() as d:
            in_path = os.path.join(d, "in.pdf")
            out_path = os.path.join(d, "out.docx")
            with open(in_path, "wb") as fh:
                fh.write(data)
            cv = Converter(in_path, password=password or None)
            try:
                cv.convert(out_path)
            finally:
                cv.close()
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 1000:
                with open(out_path, "rb") as fh:
                    docx_bytes = fh.read()
    except Exception:
        docx_bytes = None

    # 2. Fallback: PyMuPDF Word generator
    if not docx_bytes:
        try:
            docx_bytes = pdf_to_docx_fallback(data, password)
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": f"Conversion failed: {exc}"}), 500

    return Response(docx_bytes, mimetype=DOCX_MIME)


def _text_to_pdf(text: str) -> bytes:
    """Render plain / extracted text into a clean PDF."""
    doc = fitz.open()
    margin = 54
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    page = doc.new_page(width=595, height=842)
    y = margin
    for line in lines:
        if y > 842 - margin - 20:
            page = doc.new_page(width=595, height=842)
            y = margin
        page.insert_text((margin, y + 12), line[:120], fontsize=11, fontname="helv", color=(0.15, 0.2, 0.25))
        y += 18
    return doc.tobytes()


def _doc_ole_to_pdf(data: bytes) -> bytes:
    """Extract text from legacy Word 97-2004 (.doc) OLE2 stream and render to PDF."""
    try:
        import olefile

        ole = olefile.OleFileIO(data)
        if ole.exists("WordDocument"):
            stream = ole.openstream("WordDocument").read()
            cur = []
            paragraphs = []
            for b in stream:
                if 32 <= b <= 126 or b in (10, 13, 9):
                    cur.append(chr(b))
                else:
                    if len(cur) >= 3:
                        s = "".join(cur).strip()
                        if s:
                            paragraphs.append(s)
                    cur = []
            if cur:
                s = "".join(cur).strip()
                if s:
                    paragraphs.append(s)
            if paragraphs:
                return _text_to_pdf("\n\n".join(paragraphs))
    except Exception:
        pass
    return _text_to_pdf(data.decode("latin1", errors="replace"))


def _rtf_to_pdf(data: bytes) -> bytes:
    """Extract text from RTF and render to PDF."""
    text = data.decode("latin1", errors="replace")
    cleaned = re.sub(r"\\[a-zA-Z0-9\-]+ ?", " ", text)
    cleaned = re.sub(r"[{}]", "", cleaned)
    cleaned = re.sub(r" +", " ", cleaned).strip()
    return _text_to_pdf(cleaned)


def docx_to_pdf(data: bytes) -> bytes:
    """Render Word / RTF / text document to PDF with high fidelity."""
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return _doc_ole_to_pdf(data)
    if data.startswith(b"{\\rtf"):
        return _rtf_to_pdf(data)

    if data.startswith(b"PK\x03\x04"):
        # 1. Try mammoth + Headless Chrome for rich CSS typography & full tables
        try:
            import mammoth

            res = mammoth.convert_to_html(io.BytesIO(data))
            if res.value:
                html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {{ size: A4; margin: 20mm; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    line-height: 1.6;
    font-size: 13px;
    margin: 0;
    padding: 0;
  }}
  h1, h2, h3, h4, h5, h6 {{ color: #0f172a; font-weight: 700; line-height: 1.3; }}
  h1 {{ font-size: 24px; margin: 0 0 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }}
  h2 {{ font-size: 18px; margin: 20px 0 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; }}
  h3 {{ font-size: 15px; margin: 16px 0 8px; }}
  p {{ margin: 8px 0; }}
  ul, ol {{ margin: 8px 0; padding-left: 24px; }}
  li {{ margin-bottom: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; vertical-align: top; }}
  th {{ background: #f8fafc; font-weight: 600; color: #0f172a; }}
  tr:nth-child(even) td {{ background: #fbfcfe; }}
  blockquote {{ border-left: 3px solid #3b82f6; margin: 12px 0; padding: 4px 12px; color: #475569; }}
  img {{ max-width: 100%; height: auto; display: block; margin: 10px 0; }}
  a {{ color: #2563eb; text-decoration: underline; }}
</style>
</head>
<body>
{res.value}
</body>
</html>"""
                pdf = print_html_to_pdf(html)
                if pdf:
                    return pdf
        except Exception:
            pass

    # 2. ReportLab fallback
    return _docx_reportlab_fallback(data)


def _docx_reportlab_fallback(data: bytes) -> bytes:
    import docx
    from docx.document import Document as _Doc
    from docx.oxml.ns import qn
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph as DocxPara
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import (
        Image as RLImage,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
    from xml.sax.saxutils import escape

    document = docx.Document(io.BytesIO(data))

    align_map = {0: TA_LEFT, 1: TA_CENTER, 2: TA_RIGHT, 3: TA_JUSTIFY}

    def para_style(p: DocxPara) -> ParagraphStyle:
        name = (p.style.name if p.style else "") or "Normal"
        size, bold, space = 11, False, 6
        low = name.lower()
        if low.startswith("title"):
            size, bold, space = 24, True, 14
        elif low.startswith("heading 1"):
            size, bold, space = 18, True, 10
        elif low.startswith("heading 2"):
            size, bold, space = 15, True, 8
        elif low.startswith("heading"):
            size, bold, space = 13, True, 7
        al = align_map.get(int(p.alignment) if p.alignment is not None else 0, TA_LEFT)
        return ParagraphStyle(
            name or "s",
            fontName="Helvetica-Bold" if bold else "Helvetica",
            fontSize=size,
            leading=size * 1.3,
            spaceAfter=space,
            alignment=al,
        )

    def run_markup(run) -> str:
        text = escape(run.text or "").replace("\n", "<br/>").replace("\t", "&nbsp;&nbsp;&nbsp;")
        if not text:
            return ""
        attrs = []
        if run.font and run.font.size:
            attrs.append(f'size="{run.font.size.pt:.1f}"')
        try:
            if run.font and run.font.color and run.font.color.rgb:
                attrs.append(f'color="#{run.font.color.rgb}"')
        except Exception:  # noqa: BLE001
            pass
        if attrs:
            text = f'<font {" ".join(attrs)}>{text}</font>'
        if run.bold:
            text = f"<b>{text}</b>"
        if run.italic:
            text = f"<i>{text}</i>"
        if run.underline:
            text = f"<u>{text}</u>"
        return text

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    avail = pdf.width
    story: list = []
    _docx_fill_story(
        document,
        story,
        para_style,
        run_markup,
        qn,
        avail,
        Paragraph,
        Spacer,
        RLImage,
        Table,
        TableStyle,
        PageBreak,
        rl_colors,
        CT_P,
        CT_Tbl,
        DocxPara,
        DocxTable,
        _Doc,
    )
    if not story:
        story.append(Spacer(1, 1))
    pdf.build(story)
    return buf.getvalue()


def _docx_fill_story(
    document,
    story,
    para_style,
    run_markup,
    qn,
    avail,
    Paragraph,
    Spacer,
    RLImage,
    Table,
    TableStyle,
    PageBreak,
    rl_colors,
    CT_P,
    CT_Tbl,
    DocxPara,
    DocxTable,
    _Doc,
) -> None:
    def para_to_flowables(p):
        for run in p.runs:
            for blip in run._element.findall(".//" + qn("a:blip")):
                rid = blip.get(qn("r:embed"))
                if not rid:
                    continue
                try:
                    blob = document.part.related_parts[rid].blob
                    img = RLImage(io.BytesIO(blob))
                    scale = min(1.0, avail / float(img.drawWidth or avail))
                    img.drawWidth *= scale
                    img.drawHeight *= scale
                    story.append(img)
                    story.append(Spacer(1, 6))
                except Exception:  # noqa: BLE001
                    pass
        markup = "".join(run_markup(r) for r in p.runs).strip()
        style_name = (p.style.name if p.style else "") or ""
        if "bullet" in style_name.lower():
            markup = "&bull;&nbsp;&nbsp;" + markup
        elif "number" in style_name.lower():
            markup = "&bull;&nbsp;&nbsp;" + markup

        if "<w:br" in p._p.xml and 'type="page"' in p._p.xml:
            story.append(PageBreak())
        if markup:
            story.append(Paragraph(markup, para_style(p)))

    def table_to_flowable(t):
        rows = []
        for row in t.rows:
            cells = []
            for cell in row.cells:
                paras = [
                    "".join(run_markup(r) for r in pp.runs).strip()
                    for pp in cell.paragraphs
                    if "".join(run_markup(r) for r in pp.runs).strip()
                ]
                txt = "<br/>".join(paras)
                cells.append(Paragraph(txt or "&nbsp;", para_style(cell.paragraphs[0]) if cell.paragraphs else None))
            rows.append(cells)
        if not rows:
            return
        n = max(len(r) for r in rows)
        rows = [r + [""] * (n - len(r)) for r in rows]
        tbl = Table(rows, colWidths=[avail / n] * n)
        tbl.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.Color(0.8, 0.8, 0.85)),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(tbl)
        story.append(Spacer(1, 8))

    body = document.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            para_to_flowables(DocxPara(child, document))
        elif isinstance(child, CT_Tbl):
            table_to_flowable(DocxTable(child, document))


@app.route("/api/word-to-pdf", methods=["POST", "OPTIONS"])
def word_to_pdf() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    try:
        out = docx_to_pdf(data)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Conversion failed: {exc}"}), 500
    return _pdf_resp(out)


def excel_to_pdf(data: bytes) -> bytes:
    """Render an .xlsx workbook to PDF: one section per sheet, cells in a grid
    with bold/alignment and merged-cell spans preserved. Values are shown as the
    workbook stores them (formulas use their last cached result)."""
    import openpyxl
    from openpyxl.utils import get_column_letter
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors as rl_colors
    from reportlab.platypus import Paragraph, PageBreak, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    MAX_ROWS, MAX_COLS = 2000, 40
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    head = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=13, spaceAfter=6)
    base = ParagraphStyle("c", fontName="Helvetica", fontSize=8, leading=9.5)
    boldc = ParagraphStyle("cb", fontName="Helvetica-Bold", fontSize=8, leading=9.5)
    story: list = []
    for si, ws in enumerate(wb.worksheets):
        if si > 0:
            story.append(PageBreak())
        story.append(Paragraph(escape(ws.title), head))
        ncols = min(ws.max_column or 1, MAX_COLS)
        nrows = min(ws.max_row or 1, MAX_ROWS)
        rows: list = []
        for r, row in enumerate(ws.iter_rows(max_row=nrows, max_col=ncols)):
            cells = []
            for c in row:
                v = "" if c.value is None else str(c.value)
                sty = boldc if (getattr(c, "font", None) and c.font and c.font.bold) else base
                al = {"center": "center", "right": "right"}.get(getattr(getattr(c, "alignment", None), "horizontal", None) or "", "left")
                p = Paragraph(escape(v).replace("\n", "<br/>"), ParagraphStyle("x", parent=sty, alignment={"left": 0, "center": 1, "right": 2}[al]))
                cells.append(p)
            rows.append(cells)
        if not rows:
            story.append(Paragraph("(empty sheet)", base))
            continue
        avail = doc.width
        widths = []
        for ci in range(ncols):
            dim = ws.column_dimensions.get(get_column_letter(ci + 1))
            w = (dim.width if dim and dim.width else 10) * 5.2  # ~chars → points
            widths.append(max(24, min(w, 200)))
        total = sum(widths)
        if total > avail:
            widths = [w * avail / total for w in widths]
        style = [
            ("GRID", (0, 0), (-1, -1), 0.4, rl_colors.Color(0.8, 0.8, 0.85)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [rl_colors.white, rl_colors.Color(0.97, 0.97, 0.99)]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]
        for mc in list(getattr(ws.merged_cells, "ranges", []) or []):
            if mc.min_col - 1 < ncols and mc.min_row - 1 < nrows:
                style.append(("SPAN", (mc.min_col - 1, mc.min_row - 1),
                              (min(mc.max_col, ncols) - 1, min(mc.max_row, nrows) - 1)))
        t = Table(rows, colWidths=widths, repeatRows=0)
        t.hAlign = "LEFT"
        t.setStyle(TableStyle(style))
        story.append(t)
    wb.close()
    if not story:
        story.append(Spacer(1, 1))
    doc.build(story)
    return buf.getvalue()


def pdf_to_excel(data: bytes) -> tuple[bytes, int]:
    """Detect tables in a PDF (PyMuPDF) and write each to its own worksheet.
    Falls back to a text dump when no tables are found."""
    import openpyxl

    doc = fitz.open(stream=data, filetype="pdf")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    found = 0
    try:
        for pno, page in enumerate(doc, start=1):
            try:
                tabs = page.find_tables()
            except Exception:  # noqa: BLE001
                continue
            for ti, tab in enumerate(tabs.tables):
                found += 1
                ws = wb.create_sheet(f"p{pno}_t{ti + 1}"[:31])
                for row in tab.extract():
                    ws.append(["" if c is None else str(c) for c in row])
        if found == 0:
            ws = wb.create_sheet("text")
            for pno, page in enumerate(doc, start=1):
                for line in page.get_text().splitlines():
                    ws.append([line])
    finally:
        doc.close()
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), found


def _theme_map():
    """MSO_THEME_COLOR member → the <a:clrScheme> child name that defines it.

    tx1/bg1/tx2/bg2 map to dk1/lt1/dk2/lt2 under the standard (default) colour
    map carried by nearly every master; honouring a non-default clrMap would need
    the master's mapping, which we leave as a rare edge case."""
    from pptx.enum.dml import MSO_THEME_COLOR as T

    return {
        T.DARK_1: "dk1", T.LIGHT_1: "lt1", T.DARK_2: "dk2", T.LIGHT_2: "lt2",
        T.TEXT_1: "dk1", T.BACKGROUND_1: "lt1", T.TEXT_2: "dk2", T.BACKGROUND_2: "lt2",
        T.ACCENT_1: "accent1", T.ACCENT_2: "accent2", T.ACCENT_3: "accent3",
        T.ACCENT_4: "accent4", T.ACCENT_5: "accent5", T.ACCENT_6: "accent6",
        T.HYPERLINK: "hlink", T.FOLLOWED_HYPERLINK: "folHlink",
    }


def _theme_colors(master) -> dict:
    """Parse a slide master's theme into {scheme-name: 'RRGGBB'} so scheme
    (theme) colours can be resolved to real RGB — without this every theme-
    coloured run renders black because python-pptx can't give it an .rgb."""
    from lxml import etree
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT

    A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    try:
        theme_part = master.part.part_related_by(RT.THEME)
        root = etree.fromstring(theme_part.blob)
    except Exception:  # noqa: BLE001
        return {}
    clr = root.find(f"{{{A}}}themeElements/{{{A}}}clrScheme")
    if clr is None:
        return {}
    out: dict = {}
    for child in clr:
        key = etree.QName(child).localname
        srgb = child.find(f"{{{A}}}srgbClr")
        sysc = child.find(f"{{{A}}}sysClr")
        if srgb is not None and srgb.get("val"):
            out[key] = srgb.get("val")
        elif sysc is not None and sysc.get("lastClr"):
            out[key] = sysc.get("lastClr")
    return out


def _apply_brightness(rgb: tuple, b: float) -> tuple:
    """Apply python-pptx's brightness (tint when >0, shade when <0)."""
    if b > 0:
        return tuple(int(round(ch + (255 - ch) * b)) for ch in rgb)
    f = 1.0 + b
    return tuple(int(round(ch * f)) for ch in rgb)


def _resolve_color(cf, theme: dict, tmap: dict) -> tuple | None:
    """Resolve a python-pptx ColorFormat to an (r,g,b) 0-255 tuple, or None when
    the colour is unset/inherited. Handles explicit RGB *and* scheme (theme)
    colours plus their tint/shade — the previous code only coped with RGB."""
    from pptx.enum.dml import MSO_COLOR_TYPE

    try:
        ctype = cf.type
    except Exception:  # noqa: BLE001
        return None
    if ctype is None:
        return None
    rgb = None
    try:
        if ctype == MSO_COLOR_TYPE.RGB:
            v = cf.rgb
            rgb = (int(v[0]), int(v[1]), int(v[2]))
        elif ctype == MSO_COLOR_TYPE.SCHEME:
            hx = theme.get(tmap.get(cf.theme_color))
            if hx and len(hx) == 6:
                rgb = (int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16))
    except Exception:  # noqa: BLE001
        return None
    if rgb is None:
        return None
    try:
        b = cf.brightness
    except Exception:  # noqa: BLE001
        b = 0
    return _apply_brightness(rgb, b) if b else rgb


def _pptx_to_html_deck(data: bytes) -> str:
    """Convert PPTX presentation into a pixel-accurate HTML slide deck."""
    import base64
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    EMU = 12700.0
    prs = Presentation(io.BytesIO(data))
    sw = prs.slide_width / EMU
    sh = prs.slide_height / EMU

    html = [
        f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page {{ size: {sw:.1f}pt {sh:.1f}pt; margin: 0; }}
body {{ margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }}
.slide {{ width: {sw:.1f}pt; height: {sh:.1f}pt; position: relative; overflow: hidden; page-break-after: always; box-sizing: border-box; background: #ffffff; }}
.shape {{ position: absolute; box-sizing: border-box; }}
</style></head><body>"""
    ]

    def render_shape(shape):
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.GROUP:
            out = []
            for sub in getattr(shape, "shapes", []):
                out.append(render_shape(sub))
            return "".join(out)

        x = (shape.left or 0) / EMU
        y = (shape.top or 0) / EMU
        w = max(1.0, (shape.width or 0) / EMU)
        h = max(1.0, (shape.height or 0) / EMU)

        if getattr(shape, "has_table", False):
            t = shape.table
            out = [f'<div class="shape" style="left:{x:.1f}pt; top:{y:.1f}pt; width:{w:.1f}pt; height:{h:.1f}pt;">']
            out.append('<table style="width:100%; height:100%; border-collapse:collapse;">')
            for row in t.rows:
                out.append("<tr>")
                for cell in row.cells:
                    bg = "#ffffff"
                    try:
                        if cell.fill and cell.fill.type == 1 and cell.fill.fore_color and cell.fill.fore_color.rgb:
                            bg = f"#{cell.fill.fore_color.rgb}"
                    except Exception:
                        pass
                    cell_text = (
                        "<br/>".join(p.text.strip() for p in cell.text_frame.paragraphs if p.text.strip()) or "&nbsp;"
                    )
                    out.append(
                        f'<td style="background:{bg}; border:1px solid #cbd5e1; padding:6px 10px; font-size:12px; color:#1e293b; vertical-align:middle;">{cell_text}</td>'
                    )
                out.append("</tr>")
            out.append("</table></div>")
            return "".join(out)

        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.PICTURE:
            try:
                b64 = base64.b64encode(shape.image.blob).decode("ascii")
                mime = shape.image.content_type or "image/png"
                return f'<img class="shape" src="data:{mime};base64,{b64}" style="left:{x:.1f}pt; top:{y:.1f}pt; width:{w:.1f}pt; height:{h:.1f}pt; object-fit:contain;" />'
            except Exception:
                pass

        # Text frames & shapes
        style = [f"left:{x:.1f}pt", f"top:{y:.1f}pt", f"width:{w:.1f}pt", f"min-height:{h:.1f}pt"]
        try:
            if shape.fill and shape.fill.type == 1 and shape.fill.fore_color and shape.fill.fore_color.rgb:
                style.append(f"background-color:#{shape.fill.fore_color.rgb}")
        except Exception:
            pass
        try:
            if shape.line and shape.line.color and shape.line.color.rgb:
                lw = max(1.0, shape.line.width.pt) if shape.line.width else 1.0
                style.append(f"border:{lw:.1f}pt solid #{shape.line.color.rgb}")
        except Exception:
            pass

        text_html = []
        if getattr(shape, "has_text_frame", False):
            style.append("display:flex; flex-direction:column; justify-content:flex-start; padding:2px;")
            for p in shape.text_frame.paragraphs:
                txt = p.text.strip()
                if not txt:
                    continue
                sz = 14
                bold = False
                italic = False
                color = "#1e293b"
                align = "left"
                if p.alignment:
                    align = {1: "left", 2: "center", 3: "right", 4: "justify"}.get(p.alignment, "left")
                if p.runs:
                    r0 = p.runs[0]
                    if r0.font.size:
                        sz = r0.font.size.pt
                    bold = bool(r0.font.bold)
                    italic = bool(r0.font.italic)
                    try:
                        if r0.font.color and r0.font.color.rgb:
                            color = f"#{r0.font.color.rgb}"
                    except Exception:
                        pass
                elif p.font and p.font.size:
                    sz = p.font.size.pt
                    bold = bool(p.font.bold)
                    italic = bool(p.font.italic)
                b_style = "font-weight:bold;" if bold else ""
                i_style = "font-style:italic;" if italic else ""
                text_html.append(
                    f'<div style="font-size:{sz:.1f}pt; color:{color}; text-align:{align}; margin:2px 0; line-height:1.25; {b_style} {i_style}">{txt}</div>'
                )

        return f'<div class="shape" style="{"; ".join(style)}">{"".join(text_html)}</div>'

    for slide in prs.slides:
        bg_col = "#ffffff"
        try:
            if (
                slide.background
                and slide.background.fill
                and slide.background.fill.type == 1
                and slide.background.fill.fore_color
                and slide.background.fill.fore_color.rgb
            ):
                bg_col = f"#{slide.background.fill.fore_color.rgb}"
        except Exception:
            pass
        html.append(f'<div class="slide" style="background:{bg_col};">')
        for shape in slide.shapes:
            html.append(render_shape(shape))
        html.append("</div>")

    html.append("</body></html>")
    return "".join(html)


def _ppt_ole_to_pdf(data: bytes) -> bytes:
    """Extract text from legacy PowerPoint 97-2004 (.ppt) OLE2 stream and render to PDF."""
    try:
        import olefile

        ole = olefile.OleFileIO(data)
        if ole.exists("PowerPoint Document"):
            stream = ole.openstream("PowerPoint Document").read()
            cur = []
            paragraphs = []
            for b in stream:
                if 32 <= b <= 126 or b in (10, 13, 9):
                    cur.append(chr(b))
                else:
                    if len(cur) >= 3:
                        s = "".join(cur).strip()
                        if s:
                            paragraphs.append(s)
                    cur = []
            if cur:
                s = "".join(cur).strip()
                if s:
                    paragraphs.append(s)
            if paragraphs:
                return _text_to_pdf("\n\n".join(paragraphs))
    except Exception:
        pass
    return _text_to_pdf(data.decode("latin1", errors="replace"))


def pptx_to_pdf(data: bytes) -> bytes:
    """Render a .pptx / .ppt to PDF with high fidelity.

    Primary: Position-accurate HTML presentation deck printed via headless Chrome.
    Fallback: ReportLab Canvas / PyMuPDF pipeline preserving tables, shapes,
    non-clipping text frames, and pictures.
    """
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return _ppt_ole_to_pdf(data)

    if not data.startswith(b"PK\x03\x04"):
        return _text_to_pdf(data.decode("utf-8", errors="replace"))

    # 1. Primary: Try HTML deck + Headless Chrome
    try:
        html = _pptx_to_html_deck(data)
        if html:
            pdf = print_html_to_pdf(html)
            if pdf:
                return pdf
    except Exception:
        pass

    # 2. Fallback: ReportLab Canvas
    return _pptx_reportlab_fallback(data)


def _pptx_reportlab_fallback(data: bytes) -> bytes:
    from pptx import Presentation
    from pptx.enum.dml import MSO_FILL
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import Frame, Paragraph, Table, TableStyle
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.utils import ImageReader
    from xml.sax.saxutils import escape

    EMU = 12700.0
    prs = Presentation(io.BytesIO(data))
    pw, ph = prs.slide_width / EMU, prs.slide_height / EMU
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(pw, ph))
    align = {1: TA_LEFT, 2: TA_CENTER, 3: TA_RIGHT}
    tmap = _theme_map()
    theme_cache: dict = {}

    def theme_for(slide) -> dict:
        try:
            master = slide.slide_layout.slide_master
        except Exception:  # noqa: BLE001
            return {}
        key = id(master)
        if key not in theme_cache:
            theme_cache[key] = _theme_colors(master)
        return theme_cache[key]

    def solid_rgb(fill, theme) -> tuple | None:
        try:
            if fill.type != MSO_FILL.SOLID:
                return None
            return _resolve_color(fill.fore_color, theme, tmap)
        except Exception:  # noqa: BLE001
            return None

    def para_markup(p, theme):
        out = ""
        for r in p.runs:
            t = escape(r.text or "")
            if not t:
                continue
            f = r.font
            attrs = []
            if f.size:
                attrs.append(f'size="{f.size.pt:.1f}"')
            rgb = _resolve_color(f.color, theme, tmap)
            if rgb:
                attrs.append('color="#%02X%02X%02X"' % rgb)
            if attrs:
                t = f'<font {" ".join(attrs)}>{t}</font>'
            if f.bold:
                t = f"<b>{t}</b>"
            if f.italic:
                t = f"<i>{t}</i>"
            out += t
        return out

    def bg_rgb(slide, theme) -> tuple | None:
        for src in (slide, getattr(slide, "slide_layout", None),
                    getattr(getattr(slide, "slide_layout", None), "slide_master", None)):
            if src is None:
                continue
            try:
                rgb = solid_rgb(src.background.fill, theme)
            except Exception:  # noqa: BLE001
                rgb = None
            if rgb:
                return rgb
        return None

    for slide in prs.slides:
        theme = theme_for(slide)
        bg = bg_rgb(slide, theme) or (255, 255, 255)
        c.setFillColorRGB(bg[0] / 255, bg[1] / 255, bg[2] / 255)
        c.rect(0, 0, pw, ph, fill=1, stroke=0)
        for shape in slide.shapes:
            try:
                x = (shape.left or 0) / EMU
                y = (shape.top or 0) / EMU
                w = (shape.width or 0) / EMU
                h = (shape.height or 0) / EMU
            except Exception:  # noqa: BLE001
                continue
            top_y = ph - y

            # Picture
            is_pic = False
            try:
                is_pic = shape.shape_type == MSO_SHAPE_TYPE.PICTURE
            except Exception:  # noqa: BLE001
                is_pic = False
            if is_pic:
                try:
                    c.drawImage(ImageReader(io.BytesIO(shape.image.blob)), x, top_y - h,
                                width=w, height=h, mask="auto")
                    continue
                except Exception:  # noqa: BLE001
                    pass

            # Table
            if getattr(shape, "has_table", False):
                t = shape.table
                t_rows = []
                for row in t.rows:
                    t_cells = []
                    for cell in row.cells:
                        txt = "<br/>".join(escape(p.text.strip()) for p in cell.text_frame.paragraphs if p.text.strip()) or "&nbsp;"
                        t_cells.append(Paragraph(txt, ParagraphStyle("tc", fontName="Helvetica", fontSize=10, leading=13)))
                    t_rows.append(t_cells)
                if t_rows:
                    ncols = max(len(r) for r in t_rows)
                    col_w = w / max(1, ncols)
                    tbl_flow = Table(t_rows, colWidths=[col_w] * ncols)
                    tbl_flow.setStyle(TableStyle([
                        ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.Color(0.8, 0.8, 0.85)),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("TOPPADDING", (0, 0), (-1, -1), 3),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ]))
                    try:
                        Frame(x, max(0, top_y - h), max(10, w), max(10, h),
                              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, showBoundary=0).addFromList([tbl_flow], c)
                    except Exception:
                        pass
                continue

            # Shape solid fill and outline
            if w > 0 and h > 0:
                fill_rgb = solid_rgb(getattr(shape, "fill", None), theme)
                line_rgb, line_w = None, 0.0
                try:
                    ln = shape.line
                    line_rgb = _resolve_color(ln.color, theme, tmap)
                    line_w = (ln.width.pt if ln.width else 0.0) or (0.75 if line_rgb else 0.0)
                except Exception:  # noqa: BLE001
                    line_rgb, line_w = None, 0.0
                if fill_rgb or (line_rgb and line_w):
                    if fill_rgb:
                        c.setFillColorRGB(fill_rgb[0] / 255, fill_rgb[1] / 255, fill_rgb[2] / 255)
                    if line_rgb and line_w:
                        c.setStrokeColorRGB(line_rgb[0] / 255, line_rgb[1] / 255, line_rgb[2] / 255)
                        c.setLineWidth(line_w)
                    c.rect(x, top_y - h, w, h,
                           fill=1 if fill_rgb else 0,
                           stroke=1 if (line_rgb and line_w) else 0)

            # Text frame
            if getattr(shape, "has_text_frame", False) and shape.text_frame.paragraphs:
                flow = []
                for p in shape.text_frame.paragraphs:
                    markup = para_markup(p, theme)
                    if not markup:
                        continue
                    sz = p.runs[0].font.size.pt if (p.runs and p.runs[0].font.size) else 18
                    st = ParagraphStyle("p", fontName="Helvetica", fontSize=sz, leading=sz * 1.2,
                                        alignment=align.get(p.alignment, TA_LEFT))
                    flow.append(Paragraph(markup, st))
                if flow:
                    try:
                        actual_h = max(h, len(flow) * 24.0)
                        Frame(x, max(0, top_y - actual_h), max(10, w), max(10, actual_h), leftPadding=2, rightPadding=2,
                              topPadding=2, bottomPadding=2, showBoundary=0).addFromList(flow, c)
                    except Exception:  # noqa: BLE001
                        pass
        c.showPage()
    c.save()
    return buf.getvalue()


def pdf_to_ppt(data: bytes) -> bytes:
    """Convert a PDF into an editable PowerPoint presentation.

    Creates a slide per page matching the page dimensions. Renders a crisp
    high-resolution background image (200 DPI) for visual exactness, and overlays
    native, editable text boxes at exact coordinates with matching font sizes,
    colors, bold/italic styles and word wrapping — giving the user the best of
    both worlds: visually perfect slides that are directly editable in PowerPoint.
    """
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.dml.color import RGBColor

    doc = fitz.open(stream=data, filetype="pdf")
    prs = Presentation()
    if doc.page_count:
        r = doc[0].rect
        prs.slide_width = Emu(int(r.width * 12700))
        prs.slide_height = Emu(int(r.height * 12700))
    blank = prs.slide_layouts[6]

    try:
        for page in doc:
            slide = prs.slides.add_slide(blank)
            pw = Emu(int(page.rect.width * 12700))
            ph = Emu(int(page.rect.height * 12700))

            # Render crisp high-DPI slide background (200 DPI)
            pix = page.get_pixmap(dpi=200)
            slide.shapes.add_picture(io.BytesIO(pix.tobytes("png")), 0, 0, width=pw, height=ph)

            # Overlay native editable text boxes
            blocks = page.get_text("blocks")
            text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]

            spans_map: list[dict] = []
            try:
                d = page.get_text("dict")
                for bl in d.get("blocks", []):
                    for l in bl.get("lines", []):
                        spans_map.extend(l.get("spans", []))
            except Exception:
                pass

            for b in text_blocks:
                x0, y0, x1, y1, text, block_no, b_type = b
                w = max(10, x1 - x0 + 6)
                h = max(10, y1 - y0 + 6)
                tb = slide.shapes.add_textbox(
                    Emu(int(x0 * 12700)),
                    Emu(int(y0 * 12700)),
                    Emu(int(w * 12700)),
                    Emu(int(h * 12700)),
                )
                tf = tb.text_frame
                tf.word_wrap = True
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                lines = [line.strip() for line in text.split("\n") if line.strip()]
                for i, line_txt in enumerate(lines):
                    para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                    para.text = line_txt
                    matching_span = next(
                        (s for s in spans_map if line_txt in s.get("text", "") or s.get("text", "").strip() in line_txt),
                        None,
                    )
                    if matching_span:
                        sz = matching_span.get("size", 14)
                        para.font.size = Pt(sz)
                        fname = (matching_span.get("font") or "").lower()
                        is_bold = bool(matching_span.get("flags", 0) & 16) or any(
                            k in fname for k in ("bold", "black", "heavy", "semibold", "-b", "_b")
                        )
                        is_italic = bool(matching_span.get("flags", 0) & 2) or any(
                            k in fname for k in ("italic", "oblique", "slanted", "kursiv", "-it")
                        )
                        if is_bold:
                            para.font.bold = True
                        if is_italic:
                            para.font.italic = True
                        if any(k in fname for k in ("times", "serif", "roman", "georgia")):
                            para.font.name = "Times New Roman"
                        elif any(k in fname for k in ("mono", "courier", "consol")):
                            para.font.name = "Courier New"
                        elif "arial" in fname:
                            para.font.name = "Arial"
                        else:
                            para.font.name = "Calibri"
                        c_val = matching_span.get("color", 0)
                        if c_val:
                            r_c = (c_val >> 16) & 255
                            g_c = (c_val >> 8) & 255
                            b_c = c_val & 255
                            para.font.color.rgb = RGBColor(r_c, g_c, b_c)
                    else:
                        para.font.size = Pt(14)
    finally:
        doc.close()

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


@app.route("/api/excel-to-pdf", methods=["POST", "OPTIONS"])
def excel_to_pdf_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, _opts, err = _read_upload()
    if err:
        return err
    try:
        out = excel_to_pdf(data)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Conversion failed: {exc}"}), 500
    return _pdf_resp(out)


@app.route("/api/pdf-to-excel", methods=["POST", "OPTIONS"])
def pdf_to_excel_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, _opts, err = _read_upload()
    if err:
        return err
    try:
        out, tables = pdf_to_excel(data)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Conversion failed: {exc}"}), 500
    resp = Response(out, mimetype=XLSX_MIME)
    resp.headers["X-Tables"] = str(tables)
    resp.headers["Access-Control-Expose-Headers"] = "X-Tables"
    return resp


@app.route("/api/ppt-to-pdf", methods=["POST", "OPTIONS"])
def ppt_to_pdf_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, _opts, err = _read_upload()
    if err:
        return err
    try:
        out = pptx_to_pdf(data)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Conversion failed: {exc}"}), 500
    return _pdf_resp(out)


@app.route("/api/pdf-to-ppt", methods=["POST", "OPTIONS"])
def pdf_to_ppt_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, _opts, err = _read_upload()
    if err:
        return err
    try:
        out = pdf_to_ppt(data)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Conversion failed: {exc}"}), 500
    return Response(out, mimetype=PPTX_MIME)


def ocr_pdf(data: bytes, language: str = "eng", dpi: int = 300) -> tuple[bytes, int]:
    """Make a scanned PDF searchable: pages that already have a real text layer
    are copied through untouched; image/scanned pages are rendered and OCR'd
    (Tesseract via PyMuPDF) into a page with an invisible, selectable text layer."""
    src = fitz.open(stream=data, filetype="pdf")
    out = fitz.open()
    ocr_pages = 0
    try:
        for page in src:
            if len((page.get_text() or "").strip()) >= 20:
                out.insert_pdf(src, from_page=page.number, to_page=page.number)
                continue
            pix = page.get_pixmap(dpi=dpi)
            try:
                ocr_bytes = pix.pdfocr_tobytes(language=language)
            except Exception:  # noqa: BLE001 — OCR unavailable → keep the image page
                tmp = fitz.open()
                tp = tmp.new_page(width=page.rect.width, height=page.rect.height)
                tp.insert_image(tp.rect, pixmap=pix)
                out.insert_pdf(tmp)
                tmp.close()
                continue
            with fitz.open("pdf", ocr_bytes) as ocr_doc:
                out.insert_pdf(ocr_doc)
            ocr_pages += 1
        result = out.tobytes(deflate=True, garbage=3)
        return result, ocr_pages
    finally:
        src.close()
        out.close()


def _hex01(hex_str: str | None) -> tuple[float, float, float]:
    if not hex_str:
        return (0.0, 0.0, 0.0)
    s = hex_str.lstrip("#")
    if len(s) != 6:
        return (0.0, 0.0, 0.0)
    try:
        return (int(s[0:2], 16) / 255, int(s[2:4], 16) / 255, int(s[4:6], 16) / 255)
    except ValueError:
        return (0.0, 0.0, 0.0)


def reflow_pdf(data: bytes, edits: list[dict]) -> bytes:
    """Rewrite whole paragraphs with real re-wrapping: for each edit, remove the
    text in its rectangle and lay the new text out inside the same box
    (`insert_textbox` wraps and we auto-shrink the size until it fits)."""
    from collections import defaultdict

    fonts = {"serif": "tiro", "mono": "cour", "sans": "helv"}
    align = {"left": 0, "center": 1, "right": 2, "justify": 3}
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        by_page: dict[int, list[dict]] = defaultdict(list)
        for e in edits:
            by_page[int(e.get("page", 1)) - 1].append(e)
        for pno, es in by_page.items():
            if pno < 0 or pno >= doc.page_count:
                continue
            page = doc[pno]
            for e in es:
                page.add_redact_annot(fitz.Rect(e["rect"]), fill=None)
            page.apply_redactions(
                images=getattr(fitz, "PDF_REDACT_IMAGE_NONE", 0),
                graphics=getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0),
            )
            for e in es:
                text = str(e.get("text", ""))
                if not text:
                    continue
                rect = fitz.Rect(e["rect"])
                fam = str(e.get("font", "sans")).lower()
                bold = bool(e.get("bold", False))
                italic = bool(e.get("italic", False))
                table = _MONO if fam == "mono" else _SERIF if fam == "serif" else _SANS
                fontname = table[(int(bold), int(italic))]
                color = _hex01(e.get("color"))
                al = align.get(str(e.get("align", "left")), 0)
                size = float(e.get("fontSize") or 11)
                s = size
                while s >= 5:
                    leftover = page.insert_textbox(rect, text, fontsize=s, fontname=fontname, color=color, align=al)
                    if leftover >= 0:
                        break
                    s -= 0.5
        return doc.tobytes(deflate=True, garbage=3)
    finally:
        doc.close()


@app.route("/api/ocr", methods=["POST", "OPTIONS"])
def ocr_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    language = str(opts.get("language", "eng") or "eng")
    try:
        out, pages = ocr_pdf(data, language=language)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"OCR failed: {exc}"}), 500
    return _pdf_resp(out, {"X-Ocr-Pages": pages})


@app.route("/api/reflow", methods=["POST", "OPTIONS"])
def reflow_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    edits = opts.get("edits") or []
    if not isinstance(edits, list) or not edits:
        return jsonify({"error": "No edits provided."}), 400
    try:
        out = reflow_pdf(data, edits)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Reflow failed: {exc}"}), 500
    return _pdf_resp(out)


def _set_para_text(p, text: str) -> None:
    """Replace a paragraph's text, keeping the first run's formatting."""
    runs = list(p.runs)
    if runs:
        runs[0].text = text
        for r in runs[1:]:
            r._r.getparent().remove(r._r)
    else:
        p.text = text


def pptx_outline(data: bytes) -> dict:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    slides = []
    for si, slide in enumerate(prs.slides):
        paras = []
        for shi, shape in enumerate(slide.shapes):
            if not getattr(shape, "has_text_frame", False):
                continue
            for pi, p in enumerate(shape.text_frame.paragraphs):
                paras.append({"id": f"{si}:{shi}:{pi}", "text": "".join(r.text for r in p.runs)})
        slides.append({"index": si, "paras": paras})
    return {"slides": slides, "count": len(slides)}


def pptx_apply(data: bytes, edits: list[dict], delete: list[int], order: list[int]) -> bytes:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    emap = {str(e["id"]): str(e.get("text", "")) for e in edits if "id" in e}
    for si, slide in enumerate(prs.slides):
        for shi, shape in enumerate(slide.shapes):
            if not getattr(shape, "has_text_frame", False):
                continue
            for pi, p in enumerate(shape.text_frame.paragraphs):
                key = f"{si}:{shi}:{pi}"
                if key in emap:
                    _set_para_text(p, emap[key])
    if delete or order:
        sld_id_lst = prs.slides._sldIdLst
        ids = list(sld_id_lst)
        drop = set(delete or [])
        keep = [i for i in range(len(ids)) if i not in drop]
        final = [i for i in (order or keep) if i in keep]
        for el in list(ids):
            sld_id_lst.remove(el)
        for i in final:
            sld_id_lst.append(ids[i])
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


@app.route("/api/pptx-outline", methods=["POST", "OPTIONS"])
def pptx_outline_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, _opts, err = _read_upload()
    if err:
        return err
    try:
        return jsonify(pptx_outline(data))
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not read presentation: {exc}"}), 500


@app.route("/api/pptx-apply", methods=["POST", "OPTIONS"])
def pptx_apply_route() -> Response:
    if request.method == "OPTIONS":
        return Response(status=204)
    data, opts, err = _read_upload()
    if err:
        return err
    try:
        out = pptx_apply(data, opts.get("edits") or [], opts.get("delete") or [], opts.get("order") or [])
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not save presentation: {exc}"}), 500
    return Response(out, mimetype=PPTX_MIME)


if __name__ == "__main__":
    # Bind to loopback only — this engine is for the local app, not the network.
    app.run(host="127.0.0.1", port=8787, debug=False)
