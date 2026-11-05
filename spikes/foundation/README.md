# SP-01: what should the application be built on?

**Question:** which foundation gets one user from "new draft" to "frozen revision with a digest" with the least code we have to own, running offline on a workstation?

We built the same thin slice twice and drove both with one test script (`scenario.mjs`):

1. load the synthetic LANTERN guide;
2. remove a classified entry's reason and check the error points at that field;
3. try to freeze (must be refused);
4. put the reason back and record that a person reviewed the guide's own markings;
5. freeze, and get the payload digest.

## Run it

```bash
cd ts && npm ci && cd ..
```

```bash
cd ts && node ../scenario.mjs . node --experimental-strip-types --no-warnings server.ts
```

For Python (needs `uv`):

```bash
cd py && uv venv .venv && uv pip install --python .venv -r requirements.txt
```

```bash
cd py && node ../scenario.mjs . .venv/bin/python -I server.py
```

```bash
cd py && .venv/bin/python -I conformance_gap.py
```

## Results

| | TypeScript (Node `http`, no framework) | Python (FastAPI) |
| --- | --- | --- |
| Scenario result | All steps as expected | All steps as expected |
| Final digest | `7288…3ea6` | `7288…3ea6`, **identical** |
| Code we wrote | 88 lines server + 24 lines page | 136 lines server |
| Of which re-creates OpenSCG | 0 | about 60 (parsing, schema, 2 rules, digest, approval text) |
| OpenSCG conformance (validation cases) | **36 / 36** (SP-00) | **15 / 36** |
| Semantic rules | all 34, from the library | 2 of 34, hand-ported |
| Signing and verification | in the library | not present; would need a CMS library and a port |
| Packages installed | 12 (including OpenSCG) | 20 |
| Installed size | 6.6 MB | 15 MB |
| Time to first good response | about 190 ms | about 360 ms |
| Works with no network | yes (SP-06) | not tested; no reason to expect otherwise |

### What the numbers mean

The Python slice *looks* close: it gives the same answers on this scenario, and its digest matches byte for byte. But it only knows the two rules the scenario touches. Against the published conformance cases it passes 15 of 36. Example: it would let a guide with two entries sharing one ID, or an entry pointing at a section that does not exist, reach "approval-ready". The TypeScript slice gets all of those right for free, because it calls OpenSCG.

To close the gap in Python we would port roughly 1,300 lines of OpenSCG logic (semantic rules, strict parsing, canonical form, approval statements, CMS attestation and release manifests) and then keep the port in step with every OpenSCG release. That is a second implementation of the format, which OpenSCG already has for testing, not a product feature.

## Recommendation

**TypeScript on Node 22, with OpenSCG as the only source of format behaviour.** This supports [decision 0003](../../docs/decisions/0003-typescript-domain-core.md).

Other spikes point the same way: SP-07 found the browser cannot run OpenSCG's validator under a strict security policy, so validation belongs on the local server anyway, and that server is simplest in the same language as the library.

**One Python piece may stay:** SP-04 chose Typst for accessible PDFs, and the tested build came from its Python package. Typst is also a standalone binary, so the app can call it without Python. Pick one when building the PDF step.

**What would change this:** a first adopter who can only run approved Python images, or a required capability only practical in Python.

## Not decided here

- A web framework. Plain `node:http` was enough for the slice. A small framework may earn its place once there are more routes; choose it when the app starts.
- Desktop shell versus the user's own browser. SP-03 suggests the user's own browser, because that is where an approved signing integration would live.
