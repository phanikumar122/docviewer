#!/usr/bin/env bash
# Start the local DocuFlow PDF engine (PyMuPDF) on 127.0.0.1:8787.
# First run creates a virtualenv and installs dependencies.
set -euo pipefail
cd "$(dirname "$0")"

VENV=".venv"
PY="${VENV}/bin/python"

if [ ! -x "${PY}" ]; then
  echo "Creating virtualenv in ${VENV} …"
  if command -v uv >/dev/null 2>&1; then
    uv venv "${VENV}"
    uv pip install --python "${VENV}" pymupdf "flask>=3,<4" "pdf2docx>=0.5,<0.6" "python-docx>=1.1,<2" "reportlab>=4,<5" "openpyxl>=3.1,<4" "python-pptx>=0.6,<2" "Pillow>=10,<12" "mammoth>=1.8,<2" "olefile>=0.46"
  else
    python3 -m venv "${VENV}"
    "${PY}" -m pip install --upgrade pip
    "${PY}" -m pip install pymupdf "flask>=3,<4" "pdf2docx>=0.5,<0.6" "python-docx>=1.1,<2" "reportlab>=4,<5" "openpyxl>=3.1,<4" "python-pptx>=0.6,<2" "Pillow>=10,<12" "mammoth>=1.8,<2" "olefile>=0.46"
  fi
fi

echo "DocuFlow engine → http://127.0.0.1:8787  (Ctrl+C to stop)"
exec "${PY}" app.py
