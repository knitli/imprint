// SPDX-License-Identifier: AGPL-3.0-only
// Path A, browser side. Stands in for: "an approved interface hands the page a
// Web Crypto key it cannot export". The page builds the approval statement from
// the guide it was given, shows it, and signs it with that key.
import { buildApprovalStatement, createAttestation, approvalText, payloadDigest } from "@knitli/openscg";

window.imprintSpike = {
  async describe(guide) {
    const digest = await payloadDigest(guide);
    return { digest, text: approvalText(guide, digest) };
  },
  async sign(guide, pkcs8, certDer) {
    // extractable: false — the page can use the key but cannot read it back.
    const key = await crypto.subtle.importKey(
      "pkcs8", new Uint8Array(pkcs8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const statement = await buildApprovalStatement(guide);
    let exported = "refused";
    try { await crypto.subtle.exportKey("pkcs8", key); exported = "EXPORTED (bad)"; } catch { /* expected */ }
    const attestation = await createAttestation({
      statement, privateKey: key, certificate: new Uint8Array(certDer), signingTime: new Date(),
    });
    return { attestation, keyExport: exported };
  },
  probe() {
    // What a plain page can see. None of these are a route to a smart card.
    return {
      webCrypto: typeof crypto?.subtle?.sign === "function",
      isSecureContext,
      pkcs11Api: "pkcs11" in globalThis || "browser" in globalThis,
      platformKeysApi: !!globalThis.chrome?.platformKeys,
      webAuthn: typeof navigator.credentials?.create === "function",
    };
  },
};
