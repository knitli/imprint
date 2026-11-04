# 0007: Sign through small "signer adapters"; verify only with OpenSCG

**Status:** Proposed  
**Date:** 2026-11-04  
**Requirements:** M-09, M-10; §6  
**Spike:** SP-03 (approximated with synthetic PKI and a software token)

## What we found

All three likely shapes of an approved signing interface produced attestations that verify:

- **A. Browser key:** an integration gives the page a key it can use but not export.
- **B. Token:** Imprint builds the CMS structure and a PKCS#11 token signs it.
- **C. External signer:** a desktop tool writes a detached `.p7s` file.

Two silent traps showed up in path B. If Imprint and the token both hash, or if an RSA signature is made over a bare hash instead of a DigestInfo, the token returns a signature with no error, and it fails only at verification.

`openssl cms -verify` accepted an authentication-only certificate and a revoked certificate. OpenSCG's `verifyAttestation()` rejected both.

## Proposed choice

- Define one small adapter interface: take the approval statement bytes, return a detached CMS signature. Implement A, B and C behind it.
- An adapter is offered to users only after it passes SP-03's positive and negative cases, including the two traps.
- Verify only with OpenSCG's `verifyAttestation()` and an explicit local trust policy. Never treat a generic "signature OK" as the result.

## What this means

- Example: an agency's approved tool turns out to be path C. We write one adapter that hands it the statement file and reads back the `.p7s`; nothing else in Imprint changes.
- **What would change this:** the approved interface can sign only PDFs. Then the release manifest becomes the binding between the PDF and the JSON, and the adapter shape changes.
