# Research and spike plan

**Status:** First round of spikes complete, November 4, 2026. Synthetic data only.

## Results at a glance

| Spike | Answer | Proposed decision |
| --- | --- | --- |
| SP-00 | Yes: OpenSCG 0.1.0 passes all 64 conformance cases in our toolchain | [0002](../decisions/0002-pin-openscg.md) (accepted) |
| SP-01 | TypeScript. Same results as Python, but Python passed only 15 of 36 validation cases without porting about 1,300 lines of OpenSCG | [0003](../decisions/0003-typescript-domain-core.md) |
| SP-02 | SEE_SP02 | SEE_SP02_DECISION |
| SP-03 (approximated) | All three likely signing shapes work. Two silent traps found, and a generic verifier is not enough | [0007](../decisions/0007-signer-adapters.md) |
| SP-04 | Typst: the only candidate with a fully tagged PDF | [0005](../decisions/0005-typst-for-pdf.md) |
| SP-05 | ExcelJS with a wrapper: 105 of 114 fields round-trip, formula injection blocked | [0006](../decisions/0006-exceljs-for-workbooks.md) |
| SP-06 | Yes: the slice works with no network, and only loopback is ever contacted | — |
| SP-07 | USWDS, with validation on the local server (the in-browser validator needs `unsafe-eval`) | [0004](../decisions/0004-validate-on-local-server.md) |
| SP-08 | Not started: needs practitioners | — |

Each spike's folder under [`spikes/`](../../spikes/) has its own README with the method, the numbers and how to rerun it. The plan below is kept as written, so the expected results can be compared with what happened.

This page lists what we need to learn before we commit to a design. Each spike answers one question, has a time box, and ends with a short write-up and, where a choice is made, a decision record in [`docs/decisions/`](../decisions/).

A spike is throwaway code. It lives in [`spikes/`](../../spikes/), it is not part of the product, and nothing in it should be copied into the application without review.

## Why we are not starting with the application

The requirements (§12) recommend trying a FastAPI template against Corteza. That comparison was written before OpenSCG shipped. OpenSCG 0.1.0 now gives us, in TypeScript:

| Requirement area | Already in `@knitli/openscg` 0.1.0 |
| --- | --- |
| Strict parsing of untrusted JSON (M-08, §7) | `parseStrict()` rejects duplicate keys, bad UTF-8, oversized or too-deep input |
| Structural and semantic checks (M-02 to M-06) | `validate()` returns findings with a code, a severity and a JSON pointer to the field |
| Approval readiness (M-06, M-10) | `isApprovalReady()` |
| Canonical bytes and digest (M-07, §5) | `canonicalize()`, `payloadDigest()` |
| Approval statement (§6 step 1) | `buildApprovalStatement()` |
| Attestation verification (M-09, M-10) | `verifyAttestation()` reports binding, signature, algorithm, key usage, validity, trust, revocation and authority **separately** |
| Signed list of PDF/XLSX hashes (§5) | `buildReleaseManifest()`, `verifyReleaseManifest()` |
| Loss reports on import or migration (M-08) | `compareForLoss()` |

That changes the trade-off. A Python back end would have to reimplement or wrap all of this. A TypeScript back end can call it directly. SP-01 tests that before we decide.

## Spikes

| ID | Question | Requirements | Time box | Needs outside help? | Status |
| --- | --- | --- | --- | --- | --- |
| [SP-00](#sp-00-can-we-build-on-knitliopenscg-010) | Can we build on `@knitli/openscg` 0.1.0? | M-06, M-11 | 0.5 day | No | **Done** |
| [SP-01](#sp-01-what-should-the-application-be-built-on) | What should the application be built on? | All M | 3 days | No | **Done** |
| [SP-02](#sp-02-how-should-we-store-revisions) | How should we store revisions? | M-01, R-GIT-01 | 2 days | No | SEE_SP02_STATUS |
| [SP-03](#sp-03-how-does-an-oca-actually-sign) | How does an OCA actually sign? | M-09, M-10 | Open | **Yes** | **Approximated**; real environment still needed |
| [SP-04](#sp-04-can-we-make-an-accessible-correctly-marked-pdf-offline) | Can we make an accessible, correctly marked PDF offline? | M-05, M-07, M-14 | 2 days | No | **Done**; veraPDF run still needed |
| [SP-05](#sp-05-what-goes-in-the-workbook-and-what-is-lost) | What goes in the workbook, and what is lost? | M-07 | 1.5 days | Partly | **Done**; DoD layout still needed |
| [SP-06](#sp-06-can-we-prove-it-works-with-no-network) | Can we prove it works with no network? | M-12, M-13, §7 | 1 day | No | **Done** |
| [SP-07](#sp-07-which-ui-approach-gets-us-accessible-forms-fastest) | Which UI approach gets us accessible forms fastest? | M-14 | 2 days | Partly | **Done**; screen-reader pass still needed |
| [SP-08](#sp-08-what-do-practitioners-need-to-see) | What do practitioners need to see? | Phase 0 gate | Ongoing | **Yes** | Not started |

Suggested order: SP-01 and SP-08 first (they shape everything else), then SP-02, SP-04 and SP-07 together, then SP-05 and SP-06. SP-03 starts now as a conversation, because it depends on people and environments we do not control.

---

### SP-00: Can we build on `@knitli/openscg` 0.1.0?

**Result: yes.** See [`spikes/openscg-smoke/`](../../spikes/openscg-smoke/).

We installed the published package and ran the whole OpenSCG conformance procedure (`spec/conformance.md` §§2–5) using only files shipped inside the package.

| Section | Cases | Passed |
| --- | --- | --- |
| 2. Parsing and canonicalization | 14 | 14 |
| 3. Payload and statement bytes | 2 | 2 |
| 4. Validation | 36 | 36 |
| 5. Attestation verification | 12 | 12 |

Other things we learned:

- **Small footprint.** 11 transitive packages, about 6.6 MB installed: `ajv`, `ajv-formats`, `asn1js`, `pkijs` and their dependencies. Easy to list in an SBOM. (The project owner confirms every target network has npm and PyPI mirrors, so distribution is not a concern.)
- **Node 22 or later** is required.
- **Open question for the browser.** `ajv` builds validators by generating JavaScript at run time. A strict Content Security Policy without `unsafe-eval` would block that in the browser. SP-07 confirmed it: the in-page validator fails with an `EvalError`. Validation runs on the local server instead ([decision 0004](../decisions/0004-validate-on-local-server.md)).

**What would change this:** if a later OpenSCG release changes function names (the README says names may change before 1.0), the pinned version protects us until we upgrade on purpose. CI runs this spike on every pull request.

### SP-01: What should the application be built on?

**Question.** Which foundation gets a single user from "new draft" to "exported, verified revision" with the least code we have to own, while running offline on a workstation and later inside UDS?

**Candidates.**

1. **TypeScript local web app.** A small Node server (for example Hono or Fastify) that owns files and calls OpenSCG, plus a browser UI. One language end to end.
2. **FastAPI (Python) per requirements §12.** Python server and React UI. Needs OpenSCG behaviour in Python: either port it, or call a Node process.
3. **Desktop shell (Tauri or Electron).** Tempting for "runs on a workstation", but see the signing note below.
4. **Corteza.** Kept for the record. The requirements already say it fits later collaboration better than single-user authoring.

**Signing note that affects this choice.** The requirements assume the user's *own, already-configured* browser holds the route to their credential (§6). A desktop shell ships its own browser engine, which may not see the PKCS#11 module or certificate store the agency set up. Example: Firefox keeps its own security module list; an Electron app would not load it. Until SP-03 says otherwise, a design that opens in the user's normal browser keeps that route open.

**Method.** Build the same thin slice in candidates 1 and 2: load the synthetic LANTERN guide, edit one entry, show findings next to the field they point to, freeze, show the digest. Measure:

- lines of code we wrote, and how many lines just bridge to OpenSCG;
- packages installed and install size;
- cold start time with networking switched off;
- whether the browser bundle needs `unsafe-eval` (see SP-00).

**Done when.** A decision record says which one and why, with the numbers.

**Expected result.** Candidate 1 wins on code owned, because candidate 2 has to recreate parsing, canonicalization and attestation checks that already pass the suite. It would change if, for example, a first adopter can only run approved Python images, or practitioners need something only a Python library does well.

### SP-02: How should we store revisions?

**Question.** Should revision history use Git (through `isomorphic-git`) or plain immutable snapshot files?

**Method.** Implement both behind the same small interface: `saveDraft`, `freeze`, `listRevisions`, `read(revision)`, `diff(a, b)`. Store files on the local disk through Node, not browser storage, which avoids the LightningFS write-ordering risk the addendum describes. Then:

- kill the process in the middle of a save, 50 times, and check every revision still opens and verifies;
- open the Git version with ordinary `git log` and `git show`;
- produce a guide-aware diff: "entry `item-b` level changed from U to C", not a raw JSON diff.

**Done when.** A decision record compares the two on recovery, interoperability, complexity and what history keeps (deleted text stays in Git history, which matters for handling).

**Expected result.** Snapshots are simpler and enough for a single-user MVP; Git earns its place when people need to share history (phase 3). That would change if the crash tests show snapshots need as much machinery as Git anyway.

### SP-03: How does an OCA actually sign?

**Question.** In a real, approved browser and workstation setup, what interface can produce a document signature over our approval statement, and in what format?

This is mostly discovery, not code. It needs people and access we do not have yet:

- a contact who owns an approved workstation image (start with one unclassified environment);
- a **test** credential that is already issued and configured (we do not provision credentials);
- the agency's list of approved signing tools.

**What we can do without that access.**

- Write a harness page that, with a synthetic test certificate authority, builds an approval statement, signs it with a Web Crypto key, packages the attestation and verifies it with `verifyAttestation()`. This proves our half of the pipeline. OpenSCG already has `createAttestation()` for exactly this test use.
- Record, for Firefox and Chromium on Windows and Linux, what a page can and cannot reach. Example: a successful client-certificate login proves the browser can *authenticate* with the card; it does **not** prove a page can ask the card to sign arbitrary bytes.
- List likely fallbacks with their limits. Example: if the only approved signer is a PDF tool, the signature covers the PDF bytes, not the JSON, so we would need the release manifest to bind them.

**Done when.** We have traced one synthetic signature end to end on a representative setup, or we have a written list of blockers with owners. Until then, the public preview is labeled **unsigned**, as the requirements allow.

### SP-04: Can we make an accessible, correctly marked PDF offline?

**Question.** Which PDF tool produces a tagged, readable PDF (for screen readers) with banner markings on every page, portion marks, a **DRAFT / NOT APPROVED** label on drafts, and the guide ID, revision and digest, without any network access?

**Candidates.** Typst (recent releases advertise tagged PDF and PDF/UA output; to be verified at the pinned version), printing HTML through headless Chromium (Chromium can emit tagged PDFs), and a pure JavaScript library such as pdfmake (simpler, but we expect weak tagging).

**Method.** Render the LANTERN example with each. Check tags and reading order with a PDF accessibility checker (for example veraPDF for PDF/UA), check that every page carries the banner, and check the same input gives the same visible content twice.

**Done when.** A decision record picks one, with the checker output attached.

### SP-05: What goes in the workbook, and what is lost?

**Question.** What is our documented XLSX mapping, and what does it fail to carry?

**Method.** Write a column mapping from OpenSCG fields to sheets, using ExcelJS (MIT, on npm). Export LANTERN, then read the workbook back and compare field by field. Produce a coverage matrix and a loss report. Test formula-injection handling: an entry whose description starts with `=` must appear as text, not run as a formula.

**Outside help.** The DoD layout (DoDM 5200.45 §5.11(k)(4)) and any DTIC template have to come from someone authorized to share them. Until then, the workbook is labeled a **generic export**, not a submission.

### SP-06: Can we prove it works with no network?

**Question.** Can we show that authoring and export make no network calls at all?

**Method.** Run the SP-01 slice inside a network namespace with no interfaces (Linux `unshare -n`) and in a browser with every outbound request blocked and logged. Expected result: zero requests other than to the local server. Also: build from an offline package mirror, and generate an SBOM (`npm sbom`).

### SP-07: Which UI approach gets us accessible forms fastest?

**Question.** Which component approach gives us accessible repeating-entry forms, field-level error messages and a keyboard-only path with the least custom work?

**Candidate to try first.** The U.S. Web Design System (USWDS). Federal users already know its patterns, it documents accessible form and error-summary patterns, and its components are designed to meet Section 508. Compare with plain semantic HTML plus our own styles.

**Method.** Build one screen: the entry list and entry editor, with errors from `validate()` linked to the right field. Test keyboard-only, with a screen reader (NVDA and VoiceOver), and with automated checks (axe-core). Automated checks catch only part of the problems, so the manual pass counts most.

**Outside help.** A tester who uses a screen reader daily would make this far more reliable.

### SP-08: What do practitioners need to see?

**Question.** Do SCG authors and an OCA recognize the vocabulary, the entry layout and the approval flow?

**Method.** Short interviews with a paper or clickable mock-up using LANTERN. Ask them to walk through adding a compilation entry and approving a revision. Record words they use that we do not.

**Done when.** The phase 0 exit gate in the requirements is met: a practitioner confirms the vocabulary and the realistic examples.
