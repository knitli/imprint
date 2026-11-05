# Signing and verifying a guide

This page is for the people who set up Imprint and the people who sign guides. It describes what Imprint does today. Synthetic data only in public demos.

## What a signature does and does not show

A valid signature shows that **the holder of a trusted, unrevoked key** signed a statement bound to **this exact revision**. It does not show that the signer holds original classification authority, that the delegation covers this program and level, that your agency accepts this signature process, or that the guide was issued. Those are human determinations.

So Imprint keeps four things apart:

| What | Where it comes from | What Imprint shows |
| --- | --- | --- |
| The signature | The signed bytes | Content matches; signature valid; algorithm; certificate use |
| Trust | Your local trust folder | Chains to a trust anchor; validity period; revocation |
| Authority | A person's review, recorded in Imprint | "Not verified by a person" until someone records it |
| Issuance | Your organization | Never recorded by Imprint |

The headline for each signature uses the OpenSCG wording. For example, a technically valid signature with no recorded review reads **"Signature valid; authority not verified."**

## For administrators: the trust folder

Imprint trusts nothing until you give it trust anchors. Set `IMPRINT_TRUST_DIR`, or use the default `<data folder>/trust`:

```text
anchors/         trust anchor certificates (PEM or DER)
intermediates/   extra intermediate certificates
crls/            certificate revocation lists (PEM or DER)
policy.json      {"unknown_revocation": "fail" or "accept", "require_non_repudiation": true or false}
```

Imprint never fetches anything from the network. Copy current CRLs into `crls/` through your approved process. If no current CRL covers a certificate, its revocation status is **unknown**, and the default policy treats the signature as not valid. If your policy accepts unknown status, Imprint says so next to every signature it affects.

The **Trust settings** page (`/trust`) shows what Imprint loaded and any files it could not read.

## For signers: three ways to sign

On the revision page, Imprint shows the approval statement and offers `approval-statement.bin`: the exact bytes to sign. Imprint never asks for a PIN or a private key.

1. **An approved signing tool.** Make a detached CMS (PKCS #7) signature of `approval-statement.bin`, usually a `.p7s` file, with a document-signing certificate. Upload it on the revision page. DER, PEM and base64 are all accepted.

2. **A PKCS#11 token, with Imprint's helper.** On the workstation with the token:

   ```bash
   npm run sign -- --module /path/to/pkcs11-module.so --id KEY-ID --in approval-statement.bin --out approval-statement.p7s
   ```

   The helper uses OpenSC's `pkcs11-tool`. The token's own software asks for the PIN. The helper reads the certificate from the token, or from `--cert`. It checks its own signature before writing the file, which catches tokens that hash differently than expected (spike SP-03). Then upload the `.p7s` file.

3. **A browser integration that exposes a key to the page.** Not built: no approved integration of this kind has been identified (decision 0007, path A).

Paths 1 and 2 also work when Imprint runs on a server, for example in UDS: signing happens on the workstation and only the signature file is uploaded.

### What Imprint refuses

- A signature over anything other than this revision's approval statement.
- A damaged signature, or a file that is not a detached CMS signature.

A signature that is mathematically valid but fails trust (for example, a login-only certificate or a revoked one) is stored, and shown as not valid with the reason. The result can change later if the trust folder changes.

## Recording the authority review

After signing, a person checks the signer's authority and records the result in the **Authority review** form: not started, in progress, complete, or rejected, with who, when and any evidence. The review is kept outside the signed content, so recording it never changes the signature.

## Releasing files

The revision page lists the frozen JSON, PDF, workbook, each signature file, a combined "signed guide" JSON, and a release manifest with the SHA-256 of every file. You can sign `release-manifest.bin` the same way as the approval statement. A signed manifest lets anyone check that a PDF or workbook is exactly the one released. Sign the manifest after all approval signatures are in, because each one adds a file to it.

## Acceptance environment

Decision 0009 sets the MVP acceptance environment: a self-signed PKCS#11 software token (SoftHSM2) used with OpenSC. The automated tests run both signing paths against it with EC and RSA keys, and check the failure cases: wrong trust anchor, revoked certificate, login-only certificate, and content changed after signing.
