# SP-05: What goes in the workbook, and what is lost?

**Status:** done (first pass). Synthetic data only. Spike code, not product code.

## The question

Can we export an OpenSCG guide to an XLSX workbook that:

- follows a mapping we document;
- shows the banner, the `SYNTHETIC` and `DRAFT / NOT APPROVED` labels, and the guide ID, revision and digest;
- reads back without losing anything we did not say we would lose;
- cannot be turned into a formula attack by text in the guide?

## How to run it

```bash
npm ci
```

```bash
npm run spike
```

```bash
npm run mapping-doc
```

`npm run spike` writes everything to `out/`. It needs LibreOffice (`soffice`) for the independent formula check; without it, that one check is reported as an error and the rest still runs. `npm run mapping-doc` regenerates [MAPPING.md](MAPPING.md) from the code.

## What is here

| File | What it is |
| --- | --- |
| `mapping.mjs` | The mapping, as one table that drives both writing and reading |
| `run.mjs` | Exports, reads back, compares, checks injection and determinism |
| `gen-mapping.mjs` | Writes `MAPPING.md` from the same table |
| [`MAPPING.md`](MAPPING.md) | The documented mapping, sheet by sheet and column by column |
| `fixtures/` | Two extra synthetic guides: one with **every** schema field, one full of hostile text |
| `out/*.xlsx` | Sample workbooks. Open `out/synthetic-lantern.xlsx` first. |
| [`out/coverage.md`](out/coverage.md) | Coverage matrix: every schema field, and whether it survives |
| [`out/loss-report.md`](out/loss-report.md) | Loss report per fixture, made with OpenSCG's `compareForLoss()` |
| `out/results.json` | All results in one file |

## Results

**Coverage.** All 114 leaf fields in the OpenSCG 0.1 schema were checked by a round trip, not just listed: 105 are **mapped**, 9 are **not mapped**, none partial. The 9 are the deliberate exclusions: extensions (guide level and entry level) and attestations. A field only counts as mapped if every value of it, in every fixture, came back unchanged.

**Loss.** The LANTERN example, the requirements' compilation example and the hostile-text fixture lose nothing. The every-field fixture loses exactly its two extensions. The workbook also says so: the `About` sheet has a "Not carried in this workbook" row that lists them and flags the must-understand one.

**Formula injection: safe.** Example: an entry whose description is `=1+1` is stored as the text `=1+1`, not as a formula.

- The sheet XML has **0 formula elements**. Every value cell is a shared string (`t="s"`).
- LibreOffice opened the workbook and exported it to CSV. Every hostile cell came out as the original text (`=1+1`, `+1+1`, `@SUM(1,1)`, `=cmd|' /C calc'!A0`). Nothing was evaluated.
- We do **not** add a leading apostrophe. Typed text cells are already safe, and an apostrophe would change the data.
- Limit: this protects the XLSX. If someone saves it as CSV and opens that, the CSV has no cell types. CSV export would need its own neutralizing.

**Three ExcelJS fidelity bugs found and worked around.** Without the workaround, the round trip changed 3 descriptions:

| Input | What ExcelJS 4.4.0 did on its own | After our fix |
| --- | --- | --- |
| A carriage return (`\r`) | Became a line feed (`\n`) | Kept |
| A control character (bell, `\u0007`) | Silently deleted | Kept |
| The literal text `_x0041_` | Came back as `A` | Kept |

The fix is to escape these the standard OOXML way before writing (`_x000D_`, `_x005F_`). Excel and LibreOffice decode that. Python's `openpyxl` 3.1.5 does not fully decode it, so a Python reader would see `_x000D_` text. That only affects these rare characters.

**Determinism: fixed.** ExcelJS stamps every file inside the zip with the current time, so two exports a second apart had different bytes. Repacking the zip with one fixed timestamp makes the bytes identical for the same guide and export time.

Does that matter? Not for integrity: the release manifest signs whatever bytes we actually ship (spec §10.3). It matters for **reproducibility**: anyone can re-export the frozen revision and check they get the same hash. Use the revision's freeze time as the export time.

**Weight.** ExcelJS brings in about 190 packages and makes `node_modules` about 60 MB, compared with 11 packages for OpenSCG alone. Its last release, 4.4.0, was in October 2023. `npm audit` reports a moderate advisory in its `uuid` dependency. ExcelJS only calls `uuid.v4()`, which that advisory does not affect, but it will keep showing up in scans.

## Recommendation

- Use this mapping shape: an `About` sheet, separate `Entries` and `Compilation` sheets, normalized `Controls` and `Sources` sheets, a `Links` sheet, and a `Mapping` sheet that documents the workbook inside the workbook.
- Keep ExcelJS for the MVP, with the escaping and zip-normalizing wrappers from `mapping.mjs` and the round-trip test in CI. Watch its maintenance. If it stalls or the audit noise becomes a problem, the wrapper keeps a swap contained.
- Keep calling it a **generic export**. The limitations statement is printed on the `About` sheet.

## What would change this

- **The real DoD layout.** If we get the DoDM 5200.45 §5.11(k)(4) workbook layout or a DTIC template through an authorized route, the column layout will change. The round-trip and injection tests stay the same.
- **Practitioners preferring one sheet.** If they want elements and compilations in one table, merge the two sheets. The `Guide order` column already keeps the original order.
- **Extensions that matter.** If a must-understand extension becomes common, it will need its own sheet.
- **Workbook import (phase 3).** Reading workbooks people have edited by hand is a different, harder problem than reading our own exports. It needs hostile-file handling and must refuse ambiguous mappings.

## Human follow-up

- Get the DoD workbook layout and any DTIC template through an authorized route ([open question 3](../../docs/open-questions.md)).
- Have a practitioner check the column names and sheet split (SP-08).
- Do an accessibility pass on the workbook in Excel: sheet names, header rows, reading order (M-14).
