# SP-06: does it work with no network?

**Question:** can we show that authoring and freezing make no network calls at all?

**Answer: yes, for the SP-01 TypeScript slice.** It ran the whole scenario (load, edit, find errors, record markings review, freeze, compute digest) inside a network namespace with no route out, and an audit of every network call found only the local loopback address.

## Run it

Linux only. Needs unprivileged user namespaces, Node 22, Python 3 and `strace`. Install the SP-01 slice first (`npm ci` in `../foundation/ts`).

```bash
./run-offline.sh
```

## Results

| Test | How | Result |
| --- | --- | --- |
| No network at all | `unshare -rn`: a fresh network namespace where only loopback is up. A connection to 1.1.1.1 fails with "Network is unreachable" | Whole slice works. Freeze returns 201 and the same digest as with networking on |
| Every network call | `strace -e connect,bind` on the server and the test driver | 3 calls, all to 127.0.0.1. No DNS lookups, no outside addresses |
| SBOM | `npm sbom --sbom-format cyclonedx --omit dev` | 12 components, CycloneDX 1.5. Licenses: Apache-2.0, MIT, BSD-3-Clause |

The other spikes checked the same thing for their part:

| Spike | Network check |
| --- | --- |
| SP-03 signing | The browser page made no requests outside its local server |
| SP-04 PDF | All three renderers work with no network. Typst bundles its fonts |
| SP-07 UI | No requests to other origins, no Content Security Policy violations |

## Distribution

The project owner confirms that every target network has npm and PyPI mirrors, so installing from an approved mirror is not a concern. The remaining offline work is about what the running app does, which this spike covers.

## What this does not show

- The browser side of a full app with a real UI. SP-07 checked its own page; a combined check belongs in the app's CI.
- Revocation data. Imprint must read CRLs supplied offline (OpenSCG's trust policy already takes them as input) and must say when revocation status is unknown. SP-03 showed both behaviours.

## Recommendation

Make the two tests here part of the application's CI: run the end-to-end tests inside `unshare -rn`, and fail the build if `strace` sees any address other than loopback.
