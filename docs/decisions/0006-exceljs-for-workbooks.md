# 0006: Generate workbooks with ExcelJS behind a small wrapper

**Status:** Proposed  
**Date:** 2026-11-04  
**Requirements:** M-07; §7 (untrusted input, formula injection)  
**Spike:** SP-05

## What we found

- 105 of the 114 leaf fields in the OpenSCG 0.1 schema survive a write-and-read-back round trip unchanged. The other 9 (extensions and attestations) are left out on purpose and listed in the workbook's "About" sheet.
- Text starting with `=`, `+`, `-`, `@`, tab or carriage return is stored as plain text, never as a formula. LibreOffice confirmed it.
- ExcelJS 4.4.0 has three silent data bugs: it turns CR into LF, deletes control characters, and decodes the literal text `_x0041_` as `A`. Escaping first works around all three.
- ExcelJS stamps the current time inside the file. Repacking with a fixed time makes the output identical on every run.
- ExcelJS is heavy (about 190 packages, 60 MB) and has had no release since October 2023.

## Proposed choice

Use ExcelJS, but only through the spike's wrapper (`mapping.mjs`), which applies the escaping and the fixed timestamp. Run the round-trip and injection tests in CI. Label every workbook "generic export — not a DTIC submission".

## What would change this

The DoD workbook layout becomes available (open question 3), or ExcelJS's lack of maintenance becomes a security finding we cannot accept. The wrapper keeps a later swap small.
