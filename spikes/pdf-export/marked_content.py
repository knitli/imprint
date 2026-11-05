# SPDX-License-Identifier: AGPL-3.0-only
# For page 1 of each PDF, report which marked-content context each text run is
# drawn in: tagged (MCID, reachable by assistive technology), Artifact (skipped
# by assistive technology), or none (untagged, a PDF/UA failure).
# Run with: python3 -I marked_content.py out/*.pdf
import sys
from pypdf import PdfReader

for f in sys.argv[1:]:
    r = PdfReader(f)
    page = r.pages[0]
    stack, runs = [], {"tagged": [], "artifact": [], "untagged": []}
    def visitor_op(op, args, cm, tm):
        if op in (b"BDC", b"BMC"):
            tag = str(args[0])
            stack.append("artifact" if tag == "/Artifact" else ("tagged" if op == b"BDC" else "untagged"))
        elif op == b"EMC" and stack:
            stack.pop()
    def visitor_text(text, cm, tm, fd, fs):
        t = text.strip()
        if t:
            ctx = "artifact" if "artifact" in stack else ("tagged" if "tagged" in stack else "untagged")
            runs[ctx].append(t)
    page.extract_text(visitor_operand_before=visitor_op, visitor_text=visitor_text)
    print(f"\n{f}")
    for k, v in runs.items():
        joined = " ".join(v)
        print(f"  {k:9} {len(v):3} runs. Banner present: {'UNCLASSIFIED' in joined}. DRAFT present: {'DRAFT' in joined}. Sample: {joined[:90]!r}")
