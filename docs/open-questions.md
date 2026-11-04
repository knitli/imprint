# Open questions

Questions we cannot answer from the code or the requirements. Each has an owner. When one is answered, record the answer and where it came from, then move it to the "Answered" section.

| # | Question | Why it matters | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | Who is the first adopter, and do they run a workstation, a shared server or UDS? | Shapes SP-01 and how soon UDS packaging matters. | Project owner | Open |
| 2 | Which approved signing tools exist on that adopter's workstations, and can we get a test credential and image? | M-09 cannot pass without it (SP-03). | Project owner with agency PKI owner | Open |
| 3 | Can we obtain the DoD workbook layout and any DTIC template through an authorized route? | Until then the XLSX is a generic export (SP-05). | Project owner | Open |
| 4 | Final Imprint license. The repository currently carries AGPL-3.0, which is the leading direction (requirements §9), pending legal review. | Affects contributors, integrators and dependency choices. | Project owner with counsel | Open |
| 5 | Contributor agreement. `CLA.md` was adapted from another Knitli project and needs counsel review for Imprint, including employer-owned contributions and the commercial-license option. | Requirements §9 calls for a counsel-reviewed agreement. | Project owner with counsel | Open |
| 6 | Should OpenSCG ship a precompiled validator for browsers with a strict Content Security Policy? SP-07 confirmed the current one fails without `unsafe-eval`. Imprint does not depend on it (validation runs on the local server), but it would allow instant in-page feedback. | Nice to have, not a blocker (decision 0004). | OpenSCG maintainers | Open |
| 7 | Who can review accessibility with assistive technology users? | M-14's acceptance needs a real review, not only automated checks. | Project owner | Open |
| 8 | Which practitioners and OCAs will review vocabulary and examples, and can we name them? | Phase 0 exit gate; G-05 says name reviewers only with permission. | Project owner | Open |
| 9 | Who can run veraPDF (PDF/UA-1) on the Typst sample? This environment blocked it. | Needed before decision 0005 is accepted. | Any developer with a workstation | Open |
| 10 | Which browsers and operating systems must the first release support? SP-03 tested only Chromium on Linux. | Firefox handles security modules differently. | Project owner | Open |
| 11 | Who can run a real power-loss test (for example, a virtual machine hard reset) on the snapshot store? | A killed process is gentler than losing power (decision 0008). | Any developer | Open |

## Answered

None yet.
