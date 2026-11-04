# 0004: Run validation on the local server, and use USWDS for the interface

**Status:** Proposed  
**Date:** 2026-11-04  
**Requirements:** M-02 to M-06, M-14; §7 (security)  
**Spikes:** SP-07, SP-01, SP-06

## What we need to decide

Where OpenSCG's `validate()` runs, and which component approach the interface uses.

## What we found

- In the browser, `validate()` fails under a strict Content Security Policy (`script-src 'self'`) with an `EvalError`. Its schema validator (ajv) generates code at run time. It only works if the page allows `'unsafe-eval'`, which weakens the main defence against injected scripts.
- Running `validate()` on the local server and posting the guide to it works with the strict policy and no violations.
- ajv can precompile a structure-only validator with no eval. Using it for the full check would need a change in OpenSCG.
- USWDS and plain semantic HTML both passed axe with zero violations and a scripted keyboard-only pass. The plain version needed three CSS fixes that USWDS already handles.

## Proposed choice

1. Validation, freezing, digests and verification run on the local Node server. The page never needs `'unsafe-eval'`.
2. The interface uses USWDS 3, served from Imprint itself, never a CDN.

## What this means

- Example: a user types in an entry and presses "Check this entry". The page sends the entry to `127.0.0.1`, the server runs `validate()`, and the page shows the findings next to the fields. Nothing leaves the machine (SP-06).
- The server is the enforcement point, which matches requirements §7: a check in the page is not a security boundary.
- USWDS adds about 600 KB to what the page loads. Federal users will recognise its patterns.
- **What would change this:** OpenSCG ships a precompiled validator, which would allow instant in-page feedback as well. The server check would still be the one that counts.
