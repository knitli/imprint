# SP-04: Accessible, correctly marked PDF, offline

**Question:** which PDF tool can produce a tagged PDF that a screen reader can follow, with banner markings on every page, portion marks, a **DRAFT / NOT APPROVED** label, and the guide ID, revision and digest, without network access?

**Short answer:** Typst. It was the only candidate that tagged every piece of content correctly, enforced PDF/UA-1 rules at compile time, produced identical bytes on every run, and rendered fastest. Our checker still has to confirm that result (see "Needs a person").

All content is the synthetic LANTERN guide that ships with `@knitli/openscg` 0.1.0.

## What we built

All three renderers read the same view model (`model.mjs`, written to `out/model.json`), so they print identical content:

- the banner `UNCLASSIFIED — SYNTHETIC EXAMPLE` at the top and bottom of every page;
- a diagonal **DRAFT / NOT APPROVED** watermark and a boxed draft notice, because LANTERN still has an open review item (`OSCG-V046`);
- a footer on every page with the guide ID, revision `2026-r1` and payload digest `sha-256:0707eed2…cc42` (from `payloadDigest()`, which matches the OpenSCG test vector);
- section titles and entries with portion marks (`(U)`);
- a table of entries, including the compilation entry ("Compilation of gen-sponsor, perf-band when: …") and the level range with its conditions.

Sample outputs: [`out/typst.pdf`](out/typst.pdf), [`out/chromium.pdf`](out/chromium.pdf), [`out/pdfmake.pdf`](out/pdfmake.pdf).

## Results

| Check | Typst 0.15.0 (Python `typst` 0.15.0) | Chromium print (Playwright 1.63.0) | pdfmake 0.2.20 |
| --- | --- | --- | --- |
| Banner top and bottom of every page | Yes | Yes | Yes |
| Draft label, IDs, digest, compilation entry present | Yes | Yes | Yes |
| Tagged (has `StructTreeRoot`, `MarkInfo/Marked`) | Yes | Yes | **No** |
| Document language (`/Lang`) | `en` | `en` | **Missing** |
| Table structure (`Table`, `TH`, `TD`) | Yes, with `THead` and `TBody` | Yes | No |
| Running banners and watermark marked as artifacts | Yes | **No, left untagged** | No |
| Any untagged content on page 1 | None | 7 text runs (headers, footers, watermark) | All 269 runs |
| Claims PDF/UA-1 in metadata | Yes | No | No |
| Rejects a PDF/UA mistake at compile time | **Yes**: a missing title stopped the build | No | No |
| Same bytes on two runs | **Yes** | No (same text) | Yes |
| Works with no network (`unshare -rn`) | Yes | Yes | Yes |
| Render time, this guide | ~0.06 s | ~0.9 s (starts a browser) | ~0.5 s |
| Install size | ~77 MB wheel (fonts and compiler included) | Needs a Chromium build | Small; npm only |

### What the tagging rows mean

A screen reader follows the tags, not the visible page.

- **Untagged content** breaks PDF/UA. The reader may skip it or read it out of order. Chromium leaves its print header and footer untagged. pdfmake tags nothing at all.
- **Artifacts** are content the reader skips on purpose, such as running headers. Typst marks the repeated banners this way. That is correct for PDF/UA, but it has a consequence: a screen reader user would never hear the banner. So every template states the overall marking once in the body ("Overall classification of this document: …"), where it is tagged and read aloud. Any real template needs to keep that line.

## Recommendation

Use **Typst** for the PDF export, run through the Python package or the Typst command-line tool.

Reasons:
- It is the only candidate that tags everything correctly.
- It refuses to build some PDF/UA mistakes instead of shipping them.
- Its output is byte-for-byte repeatable. That makes it easy to put PDF hashes in a signed release manifest (`buildReleaseManifest()`).

**What would change this:**
- veraPDF or a human accessibility review finds Typst failures we cannot fix in the template.
- We need HTML and PDF to share one layout exactly. Chromium would then be worth the extra work to repair its header and footer tagging, for example by printing the banners in page content instead of `headerTemplate`.
- The domain core cannot call a Typst binary or a Python wheel. The Typst compiler also has WebAssembly builds for JavaScript, which we did not test here.

pdfmake is ruled out for the main export: it produces no tags at all.

## Needs a person

1. **veraPDF check not run.** The sandbox did not allow running the downloaded veraPDF installer. Someone should run `verapdf --flavour ua1 out/typst.pdf` on a workstation and attach the report. Typst's built-in PDF/UA-1 check passed, but that is not the same as an independent validator.
2. **Screen reader pass.** Open `out/typst.pdf` in NVDA (with Acrobat Reader) and VoiceOver (with Preview). Check that the overall marking, headings, table headers and the compilation entry are read in a sensible order.
3. **Marking layout.** Someone who knows marking rules should confirm the banner, portion marks and the draft notice are placed acceptably for a guide's own markings (requirement M-05).

## Smaller notes

- Typst hyphenated long entry IDs across lines (`gen-` / `sponsor`). Text extraction still matches once spaces are removed. A real template should disable hyphenation in ID cells.
- The Typst "Open review items" lines were not tagged as a list (`L` / `LI`). Use Typst's list markup in a real template.
- This sandbox lacks an oblique DejaVu font, so pdfmake's italics fall back to the regular face.
- Chromium output differs in bytes between runs (creation time and IDs). Its text is identical.

## Run it

```bash
npm ci
```

```bash
python3 -m pip install -r requirements.txt
```

```bash
./render-all.sh
```

`render-all.sh` renders each candidate twice, compares the two renders, then runs the checks:

- `inspect_pdf.py`: tags, language, banners on every page, required text;
- `marked_content.py`: which text is tagged, artifact or untagged;
- `determinism.py`: whether two renders match.

To check that no network is needed:

```bash
unshare -rn ./render-all.sh
```

## Layout fixes after review

A visual check of `out/typst.pdf` found two layout bugs that the automated checks did not catch:

- The payload digest ran off the right edge of the page. It now wraps, and is set in a monospaced font.
- In the Performance table, the level column grew to fit the long level-range text and pushed the Reason and Declassify columns off the page. Columns now have fixed widths. The level column shows only "U to C", and the conditions appear under the information text.

Lesson for the real template: tag and text checks do not show layout problems. Add a visual check, such as rendering each page to an image and reviewing it, to the PDF tests.
