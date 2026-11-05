# Requirements traceability

This table tracks each Imprint requirement from [requirements.md](requirements.md) to the work that will satisfy and test it. Update it in the same pull request as the work.

**Status key:** Not started · Researching · In progress · Passing (acceptance test exists and passes) · Blocked (needs something outside the project)

## MVP requirements

| ID | Short name | Spikes that inform it | OpenSCG functions it relies on | Status |
| --- | --- | --- | --- | --- |
| M-01 | Local drafts with stable IDs | SP-01, SP-02 | `parseStrict`, `payloadDigest` | In progress: create, save, reopen, freeze, new revision; tests in `test/unit/service.test.ts` |
| M-02 | Precise entries, levels, reasons | SP-07 | `validate` | In progress: entry editor with field-level errors |
| M-03 | Declassification instructions | SP-07 | `validate` | In progress: date, event, relative (kept relative) and exemption with evidence |
| M-04 | Conditional and compilation guidance | SP-07, SP-08 | `validate` | In progress: compilation entries, conditions and references round-trip |
| M-05 | The guide's own markings | SP-04 | `validate` | In progress: markings form, kept separate from entries, with a human review status |
| M-06 | Actionable checks; never "compliant" | SP-00, SP-07 | `validate`, `isApprovalReady`, `RULES` | In progress: findings grouped by severity, linked to fields |
| M-07 | JSON, PDF and XLSX from one frozen revision | SP-04, SP-05 | `canonicalize`, `payloadDigest`, `buildReleaseManifest` | In progress: exports, unsigned release manifest and bundle; cross-output tests in `test/unit/exports.test.ts` |
| M-08 | Import with no silent loss | SP-01 | `parseStrict`, `validate`, `compareForLoss` | In progress: strict import, loss check, signed files must still match |
| M-09 | Sign with an existing credential | SP-03 | `buildApprovalStatement`, `verifyAttestation` | In progress: external-tool and PKCS#11 helper paths, tested against SoftHSM2 (decision 0009 acceptance environment) |
| M-10 | Separate draft, signed, verified and authority states | SP-03 | `verifyAttestation` | In progress: per-result display, human authority review recorded separately, OpenSCG headline wording |
| M-11 | Declared OpenSCG version; conformance | SP-00 | whole suite | In progress: validation suite runs through Imprint's service in CI |
| M-12 | No network for core functions | SP-06 | — | In progress: no network calls; trust anchors and CRLs supplied offline; unknown revocation shown and handled by local policy |
| M-13 | Synthetic-only, labeled public demo | SP-06 | — | In progress: demo mode refuses non-synthetic guides, labels every page, logs no content |
| M-14 | Accessible forms and keyboard use | SP-07, SP-04 | — | In progress: keyboard-only end-to-end test with axe on every page |

## Roadmap requirements

| ID | Short name | Spikes that inform it | Status |
| --- | --- | --- | --- |
| R-GIT-01 | Evaluate isomorphic-git | SP-02 | Researching (evaluated; not adopted for MVP, decision 0008) |
| R-GIT-02 | Bind approval to content, not a Git ref | SP-02 | Researching (binding shown to survive moved refs and rewritten history) |
| R-UDS-01 to R-UDS-04 | UDS/Zarf package (**in MVP scope**, decision 0009) | SP-09 | In progress: image, Zarf package with SBOM, UDS Package resource (ingress, SSO, default-deny network), offline smoke test in CI; docs/deploy-uds.md (decision 0010) |
