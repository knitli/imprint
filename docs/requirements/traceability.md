# Requirements traceability

This table tracks each Imprint requirement from [requirements.md](requirements.md) to the work that will satisfy and test it. Update it in the same pull request as the work.

**Status key:** Not started · Researching · In progress · Passing (acceptance test exists and passes) · Blocked (needs something outside the project)

## MVP requirements

| ID | Short name | Spikes that inform it | OpenSCG functions it relies on | Status |
| --- | --- | --- | --- | --- |
| M-01 | Local drafts with stable IDs | SP-01, SP-02 | `parseStrict`, `payloadDigest` | Not started |
| M-02 | Precise entries, levels, reasons | SP-07 | `validate` | Not started |
| M-03 | Declassification instructions | SP-07 | `validate` | Not started |
| M-04 | Conditional and compilation guidance | SP-07, SP-08 | `validate` | Not started |
| M-05 | The guide's own markings | SP-04 | `validate` | Not started |
| M-06 | Actionable checks; never "compliant" | SP-00, SP-07 | `validate`, `isApprovalReady`, `RULES` | Researching (SP-00 done) |
| M-07 | JSON, PDF and XLSX from one frozen revision | SP-04, SP-05 | `canonicalize`, `payloadDigest`, `buildReleaseManifest` | Not started |
| M-08 | Import with no silent loss | SP-01 | `parseStrict`, `validate`, `compareForLoss` | Not started |
| M-09 | Sign with an existing credential | SP-03 | `buildApprovalStatement`, `verifyAttestation` | Blocked (needs a representative signing environment) |
| M-10 | Separate draft, signed, verified and authority states | SP-03 | `verifyAttestation` | Not started |
| M-11 | Declared OpenSCG version; conformance | SP-00 | whole suite | Researching (pinned; suite passes in CI) |
| M-12 | No network for core functions | SP-06 | — | Not started |
| M-13 | Synthetic-only, labeled public demo | SP-06 | — | Not started |
| M-14 | Accessible forms and keyboard use | SP-07, SP-04 | — | Not started |

## Roadmap requirements

| ID | Short name | Spikes that inform it | Status |
| --- | --- | --- | --- |
| R-GIT-01 | Evaluate isomorphic-git | SP-02 | Not started |
| R-GIT-02 | Bind approval to content, not a Git ref | SP-02 | Not started |
| R-UDS-01 to R-UDS-04 | UDS/Zarf package | after MVP | Not started |
