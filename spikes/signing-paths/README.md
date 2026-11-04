# SP-03 (approximated): signing paths

**Question:** whatever signing interface an agency has approved, can Imprint turn its output into a valid OpenSCG attestation and verify it?

We have no real workstation or credential yet, so this spike builds stand-ins for the three shapes a real interface is likely to take. Everything is **synthetic**: a throwaway certificate authority, fresh keys on every run, and the fictional LANTERN guide.

**Short answer: yes, for all three shapes.** It also turned up two traps that a real integration must avoid, and one reason Imprint should not rely on a generic signature checker.

## Run it

Needs Node 22, OpenSSL 3, SoftHSM2 and OpenSC's `pkcs11-tool` (`apt-get install softhsm2 opensc`).

```bash
npm ci
```

```bash
npm run spike
```

Expected last line: `15/15 expectations met.` Generated keys and certificates go in `out/`, which is not committed.

## The three stand-ins

| Path | What it stands in for | How the spike plays it |
| --- | --- | --- |
| **A. Browser key** | An approved extension or browser integration gives the page a key it can use but cannot export | Chromium page imports a key as non-exportable Web Crypto key, builds and signs the statement with OpenSCG's `createAttestation()` |
| **B. Token** | Card middleware or a local bridge that signs bytes on a PKCS#11 token | Imprint builds the CMS structure with PKI.js. A SoftHSM2 software token holds the key and signs. The PIN goes to the token, never to Imprint code |
| **C. External signer** | An approved desktop tool that writes a detached `.p7s` signature for a file | `openssl cms -sign` signs the statement file. Imprint wraps the result |

Every result is verified by OpenSCG's `verifyAttestation()` under a local trust policy (one synthetic root plus its CRL) and, as an independent check, by `openssl cms -verify`.

## Results

| Case | Signature | Key usage | Trust | Revocation | Technically valid | Expected? |
| --- | --- | --- | --- | --- | --- | --- |
| A. Browser key | valid | permitted | trusted | good | **yes** | yes |
| B. EC token, Imprint hashes once | valid | permitted | trusted | good | **yes** | yes |
| B. EC token, hashed twice (mistake) | **invalid** | — | — | — | no | yes |
| B. RSA token hashes and signs | valid | permitted | trusted | good | **yes** | yes |
| B. RSA, Imprint wraps hash in DigestInfo | valid | permitted | trusted | good | **yes** | yes |
| B. RSA, bare hash without DigestInfo (mistake) | **invalid** | — | — | — | no | yes |
| C. OpenSSL, minimal attributes | valid | permitted | trusted | good | **yes** | yes |
| C. OpenSSL, default attributes (adds S/MIME capabilities, signing time) | valid | permitted | trusted | good | **yes** | yes |
| C. Authentication-only certificate | valid | **not permitted** | trusted | good | no | yes |
| C. Revoked certificate | valid | permitted | trusted | **revoked** | no | yes |
| A, checked against the wrong root | valid | permitted | **untrusted** | not checked | no | yes |
| A, no CRL available, policy says fail | valid | permitted | trusted | **unknown** | no | yes |
| A, no CRL available, policy says accept | valid | permitted | trusted | unknown | yes, *and says unknown was accepted* | yes |
| A, guide edited after signing | binding **mismatch** | | | | no | yes |
| A, authority review recorded afterwards | valid; authority **review complete** | | | | yes | yes |

The last row matters for M-10. Adding a human authority review afterwards does not break the signature, because `review` is outside the signed payload. Before that review, the result is "signature valid; authority not verified".

## What we learned

1. **The format is not the hard part.** All three shapes produced attestations that verify, including OpenSSL's default output with extra signed attributes. If the approved interface can sign arbitrary bytes, or sign a file, Imprint can use it.

2. **Trap 1: hashing twice.** Some tokens hash for you (`CKM_ECDSA_SHA256`), some only sign a hash you give them (`CKM_ECDSA`). SoftHSM2 refused the hash-and-sign mechanism for EC keys, as many cards do. If Imprint hashes and the token also hashes, the signature is silently wrong. Example: the "hashed twice" row produced a signature with no error from the token. It only failed at verification.

3. **Trap 2: RSA needs a DigestInfo.** For a raw RSA PKCS#1 v1.5 signature, the hash must first be wrapped with its algorithm identifier. A bare hash produces an invalid signature, again with no error from the token. Many CAC and PIV signing certificates are RSA, so this matters.

   *For both traps:* the integration for each real interface must be tested end to end with verification, not just "the token returned something".

4. **A generic checker is not enough.** `openssl cms -verify` said "verified" for the authentication-only certificate and for the revoked certificate. It does not check the document-signing key usage, and it does not check revocation unless asked. OpenSCG's verifier rejected both. Imprint must use a verifier with an explicit policy, and our documentation for consumers should say so. (The OpenSSL column in `out/results.json` always checks against the real root, so its "verified" on the wrong-root row is expected.)

5. **A plain web page cannot reach a card.** In Chromium 153 the page sees Web Crypto and WebAuthn, but no PKCS#11 or platform-keys interface. That matches the requirements: path A only works if an approved extension or integration hands the page a key. Paths B and C need a local component or a separate tool.

6. **Imprint never needs the key or the PIN.** In path A the key could not be exported from the page. In path B only the token holds the key. In path C the tool does. The page made no requests outside its own local server.

## What this does not show

- That any **real** agency interface offers one of these shapes. That still needs a representative workstation and test credential (open question 2).
- Firefox. Only Chromium was available here.
- Hardware tokens, PIN prompts, card removal mid-signature, or slow middleware.
- Timestamping, OCSP, or certificate policies beyond key usage.

## Recommendation

Design Imprint's signing step as a small **signer adapter** interface with three implementations matching paths A, B and C. Each adapter must pass this spike's positive and negative cases before it is offered to users. The verification side needs no new work: use OpenSCG's `verifyAttestation()` with an explicit local trust policy.

**What would change this:** the approved interface turns out to sign only PDFs (then we rely on the release manifest to bind the PDF to the JSON), or it cannot sign arbitrary bytes or files at all.
