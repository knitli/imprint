# Open questions

Questions we cannot answer from the code or the requirements. Each has an owner. When one is answered, record the answer and where it came from, then move it to the "Answered" section.

| # | Question | Why it matters | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | Who is the first adopter, and do they run a workstation, a shared server or UDS? | Shapes SP-01 and how soon UDS packaging matters. | Project owner | Open |
| 2 | Which approved signing tools exist on that adopter's workstations, and can we get a test credential and image? | M-09 cannot pass without it (SP-03). | Project owner with agency PKI owner | Open |
| 3 | Can we obtain the DoD workbook layout and any DTIC template through an authorized route? | Until then the XLSX is a generic export (SP-05). | Project owner | Open |
| 4 | Final Imprint license. The repository currently carries AGPL-3.0, which is the leading direction (requirements §9), pending legal review. | Affects contributors, integrators and dependency choices. | Project owner with counsel | Open |
| 5 | Contributor agreement. `CLA.md` was adapted from another Knitli project and needs counsel review for Imprint, including employer-owned contributions and the commercial-license option. | Requirements §9 calls for a counsel-reviewed agreement. | Project owner with counsel | Open |
| 6 | Does OpenSCG plan to ship a precompiled validator for browsers with a strict Content Security Policy? | Decides whether validation can run in the browser or only on the local server (SP-00, SP-01). | OpenSCG maintainers | Open |
| 7 | Who can review accessibility with assistive technology users? | M-14's acceptance needs a real review, not only automated checks. | Project owner | Open |
| 8 | Which practitioners and OCAs will review vocabulary and examples, and can we name them? | Phase 0 exit gate; G-05 says name reviewers only with permission. | Project owner | Open |

## Answered

None yet.
