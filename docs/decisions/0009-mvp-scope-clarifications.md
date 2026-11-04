# 0009: MVP scope clarifications from the project owner

**Status:** Accepted (project owner, 2026-11-04)  
**Date:** 2026-11-04  
**Requirements:** M-09, M-10, R-UDS-01 to R-UDS-04; §8 (phases 0, 2 and 2a)

## Why this record exists

While the spikes ran, three items were treated as blockers for the MVP. The project owner clarified that none of them blocks it. This record changes how we read the requirements; it does not rewrite them.

## What the project owner decided

1. **Signing is accepted against an approximated environment.** For the MVP, a self-signed PKCS#11 software token used from Chromium is the representative signing environment. That is the SP-03 setup (SoftHSM2, a synthetic certificate authority) loaded into Chromium. A real agency workstation and credential are no longer an MVP gate. They remain useful for later field testing.

2. **The project owner is the practitioner reviewer.** The owner spent 18 years as a practitioner and decides whether vocabulary, examples, markings placement and error wording are acceptable. SP-08 (practitioner interviews) is no longer an MVP gate. Wider practitioner feedback is still welcome, and G-05's rule stands: name outside reviewers only with their permission.

3. **The UDS package ships with the first release, not after it.** R-UDS-01 to R-UDS-04 move from "shortly after MVP" (phase 2a) into the MVP. The reason: the release can say to the Air Force and to primes, "your SCG management environment is right here." The standalone local path stays as well, for demos and development.

## What this means

- The signing adapters (decision 0007) are tested end to end against SoftHSM2 in Chromium, including the double-hash and DigestInfo traps.
  - One open design point: Chromium can use a PKCS#11 token to log in to a site, but it does not let a web page ask that token to sign arbitrary data.
  - So in practice the local Imprint server will usually talk to the token through the same PKCS#11 module (path B).
  - The PIN prompt must come from the token's middleware or a protected authentication path, never from an Imprint form.
- A UDS packaging spike (SP-09) is now needed early, before most of the app is built, so packaging constraints shape the app rather than surprise it.
- The UDS package still makes no authorization claim. Packaging is not an ATO (requirements §7 and R-UDS-04).
- Open questions 2 and 8 are answered. Question 1 is partly answered.
