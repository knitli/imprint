# SP-00: OpenSCG conformance smoke test

**Question:** can Imprint build on the published `@knitli/openscg` 0.1.0 package?

**Answer:** yes. The package passes all 64 cases of the OpenSCG 0.1.0 conformance procedure (`spec/conformance.md` §§2–5) on Node 22, using only files shipped inside the package. Write-up: [`docs/research/README.md`](../../docs/research/README.md#sp-00-can-we-build-on-knitliopenscg-010).

## Run it

```bash
npm ci
```

```bash
npm run conformance
```

Expected output ends with `64/64 cases passed.` The script exits non-zero if any case fails, so CI catches a regression.

## What it checks

| Section | What | Cases |
| --- | --- | --- |
| 2 | Strict parsing and RFC 8785 canonical bytes | 14 |
| 3 | Signed payload bytes, SHA-256 digest, approval statement bytes | 2 |
| 4 | Structural and semantic validation, findings and approval readiness | 36 |
| 5 | Detached CMS attestation verification, each result reported separately | 12 |

This tests the dependency, not Imprint. Imprint's own conformance run will replace it once there is application code.
