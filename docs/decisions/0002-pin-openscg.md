# 0002: Pin an exact OpenSCG release and run its conformance suite

**Status:** Accepted  
**Date:** 2026-11-04  
**Requirements:** M-06, M-08, M-11; §5 S-05  
**Spike:** SP-00

## What we need to decide

Imprint must implement a *declared* OpenSCG version and pass its conformance fixtures (M-11). OpenSCG is pre-1.0 and its README warns that function names may change.

## Options we considered

- **Version range** (for example `^0.1.0`). Picks up fixes automatically, but a minor release before 1.0 may change behaviour under us.
- **Exact version** (`0.1.0`). Nothing changes until we upgrade on purpose.
- **Vendor the source.** Full control, but we would drift from the published specification and lose the point of an independent format.

## What we chose

Depend on an **exact** published version of `@knitli/openscg`, currently `0.1.0`, installed from the npm registry or an approved offline mirror. Run the full conformance procedure (`spec/conformance.md` §§2–5) in CI against the pinned version.

## What this means

- Imprint states "implements OpenSCG 0.1.0, suite 0.1.0" in its documentation and in its exports.
- Upgrading OpenSCG is a deliberate pull request that bumps the version, re-runs the suite and notes any behaviour change.
- If the suite fails after an upgrade, we do not edit the cases locally (the conformance procedure forbids it); we raise an issue with OpenSCG.
- Example: if OpenSCG 0.2.0 adds a new semantic rule, Imprint keeps reporting 0.1.0 findings until the upgrade pull request lands, so a user never sees findings change without a version change.
