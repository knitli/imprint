# 0005: Generate PDFs with Typst

**Status:** Accepted (project owner, 2026-11-04)  
**Date:** 2026-11-04  
**Requirements:** M-05, M-07, M-14  
**Spike:** SP-04

## What we need to decide

Which tool renders the human-readable PDF.

## What we found

| | Typst 0.15.0 | Chromium print | pdfmake 0.2.20 |
| --- | --- | --- | --- |
| Tagged for screen readers | Yes | Yes | No |
| Untagged text on page 1 | 0 runs | 7 runs | 269 runs |
| Banners marked as page artifacts | Yes | No | No |
| Refuses to build a PDF/UA-invalid document | Yes | No | No |
| Same bytes on every run | Yes | No | Yes |
| Render time | ~0.06 s | ~0.9 s | ~0.5 s |

## Proposed choice

Typst, called as a standalone binary from the Node server, with a template fed by the frozen revision.

## What this means

- Same input gives the same PDF bytes, so anyone can re-render a frozen revision and check its hash against the release manifest.
- Running banners are page artifacts, which screen readers skip. Every template must also state the overall marking once in the body text so it is read aloud.
- Tag checks did not catch two layout bugs (a digest running off the page and an over-wide column). PDF tests need a visual check too.
- **Still needed:** a veraPDF PDF/UA-1 run, which this environment blocked, and a screen-reader pass (open questions).
- **What would change this:** veraPDF finds problems Typst cannot fix, or HTML and PDF must share one layout.
