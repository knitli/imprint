# Decision records

A decision record explains one design choice: what we chose, what else we considered, and why. They let a new contributor, reviewer or assessor see how the design got here without asking.

## How to add one

1. Copy [`0000-template.md`](0000-template.md) to the next number, for example `0004-revision-storage.md`.
2. Set the status to **Proposed** and open a pull request.
3. When the pull request merges, the status becomes **Accepted**.
4. Never delete or rewrite an accepted record. To change course, write a new one and mark the old one **Superseded by NNNN**.

## Index

| No. | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-decisions.md) | Record design decisions in this folder | Accepted |
| [0002](0002-pin-openscg.md) | Pin an exact OpenSCG release and run its conformance suite | Accepted |
| [0003](0003-typescript-domain-core.md) | Build the domain core in TypeScript on the OpenSCG reference library | Proposed (SP-01 supports it) |
| [0004](0004-validate-on-local-server.md) | Run validation on the local server; use USWDS for the interface | Proposed |
| [0005](0005-typst-for-pdf.md) | Generate PDFs with Typst | Proposed |
| [0006](0006-exceljs-for-workbooks.md) | Generate workbooks with ExcelJS behind a small wrapper | Proposed |
| [0007](0007-signer-adapters.md) | Sign through small signer adapters; verify only with OpenSCG | Proposed |
