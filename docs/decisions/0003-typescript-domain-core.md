# 0003: Build the domain core in TypeScript on the OpenSCG reference library

**Status:** Proposed. Waits on spike SP-01.  
**Date:** 2026-11-04  
**Requirements:** M-01 to M-12; §12 of the requirements  
**Spike:** SP-00 (done), SP-01 (not started)

## What we need to decide

Which language owns the domain core: drafts, validation, freezing, digests, exports and verification. The UI and hosting choice can follow from it.

Requirements §12 recommends trying the FastAPI (Python) template. That was written before OpenSCG 0.1.0 shipped as a TypeScript library that already passes its own conformance suite in our environment (SP-00): 64 of 64 cases.

## Options we considered

- **TypeScript.** Calls OpenSCG directly. One language for server and browser. Signing verification (`verifyAttestation()`) already reports each result separately, which is what M-10 needs.
- **Python.** Matches §12 and may suit some deployment environments. Would need to port or wrap parsing, canonicalization, payload digests, approval statements and attestation verification, and then keep them in step with OpenSCG. OpenSCG's own repository has a Python consumer, but it is a test implementation, not a published library.

## Proposed choice

TypeScript on Node 22 or later, with OpenSCG as the single source of format behaviour. Keep the domain core free of UI and storage code so another front end can use it (requirements §12, last paragraph).

## What would change this

SP-01 shows the Python path costs less code than expected, or a first adopter can only run approved Python images, or a required capability (for example accessible PDF output) is only practical from Python.
