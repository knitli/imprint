# SPDX-License-Identifier: AGPL-3.0-only
# Render the SP-04 Typst template. Synthetic data only.
import sys, typst, datetime
out = sys.argv[1] if len(sys.argv) > 1 else "out/typst.pdf"
# Fixed timestamp so two renders give identical bytes. PDF/UA-1 asks Typst to
# enforce the accessibility rules it knows about and to tag the document.
typst.compile("guide.typ", output=out, root=".", pdf_standards=["ua-1"],
              timestamp=int(datetime.datetime(2026, 11, 4).timestamp()))
print("wrote", out)
