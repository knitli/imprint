# SPDX-License-Identifier: AGPL-3.0-only
# Inspect SP-04 PDFs: tagging, language, banners on every page, required text.
# Run with: python3 -I inspect_pdf.py out/*.pdf
import sys, json
from collections import Counter
from pypdf import PdfReader

REQUIRED = ["DRAFT / NOT APPROVED", "urn:uuid:5e1d0c3a-0000-4000-8000-00000000a001",
            "2026-r1", "0707eed223b4539cfd2605e58fac222ef3ea3d51969930497ac7d43f2af8cc42",
            "Compilation of gen-sponsor, perf-band"]
BANNER = "UNCLASSIFIED — SYNTHETIC EXAMPLE"

def struct_types(node, acc, depth=0):
    if depth > 60: return
    node = node.get_object()
    if isinstance(node, dict) or hasattr(node, "get"):
        s = node.get("/S")
        if s: acc[str(s)] += 1
        k = node.get("/K")
        if k is not None:
            k = k.get_object()
            for c in (k if isinstance(k, list) else [k]):
                c = c.get_object() if hasattr(c, "get_object") else c
                if hasattr(c, "get"): struct_types(c, acc, depth + 1)

def inspect(path):
    r = PdfReader(path)
    root = r.trailer["/Root"]
    tags = Counter()
    if "/StructTreeRoot" in root: struct_types(root["/StructTreeRoot"], tags)
    pages = [p.extract_text() or "" for p in r.pages]
    # Compare with all whitespace removed: renderers wrap long IDs differently.
    flat = "".join("".join(pages).split())
    return {
        "file": path,
        "pages": len(r.pages),
        "StructTreeRoot": "/StructTreeRoot" in root,
        "MarkInfo.Marked": bool(root.get("/MarkInfo", {}).get("/Marked")) if "/MarkInfo" in root else False,
        "Lang": str(root.get("/Lang")),
        "Title metadata": str((r.metadata or {}).get("/Title", ""))[:40],
        "struct types": dict(tags.most_common(12)),
        "banner count per page (want >=2)": [p.count(BANNER) for p in pages],
        "missing required text": [s for s in REQUIRED if "".join(s.split()) not in flat],
    }

print(json.dumps([inspect(p) for p in sys.argv[1:]], indent=1, ensure_ascii=False))
