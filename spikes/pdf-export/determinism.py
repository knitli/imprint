# SPDX-License-Identifier: AGPL-3.0-only
# Compare two renders of each candidate: identical bytes, identical text.
import hashlib
from pypdf import PdfReader
for name in ["typst", "chromium", "pdfmake"]:
    a, b = f"out/{name}-a.pdf", f"out/{name}-b.pdf"
    ha, hb = (hashlib.sha256(open(x, "rb").read()).hexdigest() for x in (a, b))
    ta, tb = ("".join(p.extract_text() for p in PdfReader(x).pages) for x in (a, b))
    print(f"{name:9} same bytes: {ha == hb}   same text: {ta == tb}")
