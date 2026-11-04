#!/usr/bin/env bash
# Render every candidate twice, then inspect. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
node model.mjs
for run in a b; do
  python3 -I render-typst.py "out/typst-$run.pdf"
  node render-chromium.mjs "out/chromium-$run.pdf"
  node render-pdfmake.mjs "out/pdfmake-$run.pdf"
done
cp out/typst-a.pdf out/typst.pdf; cp out/chromium-a.pdf out/chromium.pdf; cp out/pdfmake-a.pdf out/pdfmake.pdf
python3 -I determinism.py
python3 -I inspect_pdf.py out/typst.pdf out/chromium.pdf out/pdfmake.pdf
python3 -I marked_content.py out/typst.pdf out/chromium.pdf out/pdfmake.pdf
