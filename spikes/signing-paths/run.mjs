// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike SP-03 (approximated). Sign one OpenSCG approval statement through three
// stand-ins for real signing interfaces, then verify every result two ways:
// with @knitli/openscg's verifyAttestation() and, independently, with
// `openssl cms -verify`. Synthetic PKI and data only. See README.md.
//
//   Path A  Browser page holds a non-exportable Web Crypto key
//           (stand-in: an approved interface that exposes a CryptoKey).
//   Path B  Imprint builds the CMS; a PKCS#11 token signs only the signed
//           attributes (stand-in: card middleware or a local signing bridge).
//           SoftHSM2 plays the card.
//   Path C  An external desktop tool produces a detached .p7s over a file
//           (stand-in: an approved signing application). OpenSSL plays it.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
// The preinstalled Playwright resolves through require(), not ESM import.
const { chromium } = createRequire(import.meta.url)("playwright");
import {
  ATTESTATION_FORMAT,
  approvalStatementBytes,
  buildApprovalStatement,
  fromBase64,
  fromPem,
  isApprovalReady,
  parseStrict,
  payloadDigest,
  toBase64,
  validate,
  verifyAttestation,
} from "@knitli/openscg";

const require = createRequire(import.meta.url);
const OUT = new URL("./out/", import.meta.url).pathname;
const pkg = dirname(require.resolve("@knitli/openscg/package.json"));
const read = (f) => readFileSync(join(OUT, f));
const derCert = (f) => fromPem(read(f).toString(), "CERTIFICATE")[0];
const SOFTHSM = "/usr/lib/softhsm/libsofthsm2.so";
process.env.SOFTHSM2_CONF = join(OUT, "softhsm2.conf");

// --- The guide -------------------------------------------------------------
// LANTERN with its document markings reviewed, so it is approval-ready.
const guide = parseStrict(readFileSync(join(pkg, "conformance/cases/valid-lantern-reviewed.json")));
const findings = validate(guide);
if (!isApprovalReady(findings)) throw new Error("guide is not approval-ready");
const digest = await payloadDigest(guide);
const statement = await buildApprovalStatement(guide);
const statementBytes = approvalStatementBytes(statement);
writeFileSync(join(OUT, "statement.bin"), statementBytes);

// --- Trust policies --------------------------------------------------------
const root = derCert("root.pem");
const crl = fromPem(read("root.crl.pem").toString(), "X509 CRL")[0];
const at = new Date();
const policy = { trustAnchors: [root], crls: [crl], time: at };
const policies = {
  standard: policy,
  "wrong anchor": { ...policy, trustAnchors: [derCert("other-root.pem")] },
  "no CRL, fail": { trustAnchors: [root], time: at },
  "no CRL, accept": { trustAnchors: [root], time: at, unknownRevocation: "accept" },
};

// --- Path A: browser page with a non-exportable Web Crypto key -------------
async function pathA() {
  const html = `<!doctype html><meta charset="utf-8"><title>SP-03 path A</title>
<script src="/bundle.js"></script>`;
  const bundle = read("browser-bundle.js");
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/bundle.js") res.writeHead(200, { "content-type": "text/javascript" }).end(bundle);
    else res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const external = [];
    page.on("request", (r) => { if (!r.url().startsWith(origin)) external.push(r.url()); });
    await page.goto(origin);
    const probe = await page.evaluate(() => window.imprintSpike.probe());
    const shown = await page.evaluate((g) => window.imprintSpike.describe(g), guide);
    // The key bytes are handed to the page only because this is a stand-in.
    // A real approved interface would hand the page a key handle, never bytes.
    const pkcs8 = [...execFileSync("openssl", ["pkcs8", "-topk8", "-nocrypt", "-outform", "DER", "-in", join(OUT, "signer.key")])];
    const { attestation, keyExport } = await page.evaluate(
      ([g, k, c]) => window.imprintSpike.sign(g, k, c), [guide, pkcs8, [...derCert("signer.pem")]]);
    return { attestation, notes: { probe, shownDigest: shown.digest.value, keyExport, externalRequests: external.length, browser: browser.version() } };
  } finally {
    await browser.close();
    server.close();
  }
}

// --- Path B: Imprint builds the CMS; a PKCS#11 token signs ------------------
// `mode` decides which bytes cross to the token:
//   "attrs"        the DER of the signed attributes; the token hashes and signs
//                  (CKM_ECDSA_SHA256). SoftHSM2, like many cards, does not
//                  offer this for EC keys, so we record whether it is refused.
//   "hash"         Imprint hashes the signed attributes once; the token signs
//                  that hash raw (CKM_ECDSA). This is how PIV-style cards work.
//   "double-hash"  Imprint hashes twice before the token signs (the classic
//                  mistake when two components both "helpfully" hash).
function tokenSign(data, mechanism, id = "01") {
  const inFile = join(OUT, "tbs.bin");
  const outFile = join(OUT, "sig.der");
  writeFileSync(inFile, data);
  // The PIN is given to the token by this harness, which plays the approved
  // middleware. In a real deployment Imprint never sees, asks for or logs it.
  execFileSync("pkcs11-tool", ["--module", SOFTHSM, "--login", "--pin", "123456", "--sign", "--id", id,
    "--mechanism", mechanism, "--signature-format", "openssl", "--input-file", inFile, "--output-file", outFile],
    { stdio: ["ignore", "ignore", "pipe"] });
  return new Uint8Array(readFileSync(outFile));
}

class TokenEngine extends pkijs.CryptoEngine {
  constructor(mode) { super({ name: "token", crypto: globalThis.crypto }); this.mode = mode; }
  async signWithPrivateKey(data) {
    const tbs = new Uint8Array(data);
    if (this.mode === "attrs") return tokenSign(tbs, "ECDSA-SHA256").buffer;
    let hash = new Uint8Array(await crypto.subtle.digest("SHA-256", tbs));
    if (this.mode === "double-hash") hash = new Uint8Array(await crypto.subtle.digest("SHA-256", hash));
    return tokenSign(hash, "ECDSA").buffer;
  }
}

// RSA PKCS#1 v1.5. A raw CKM_RSA_PKCS signature must be over a DigestInfo
// (the hash wrapped with its algorithm identifier), not the bare hash.
const SHA256_DIGESTINFO_PREFIX = Uint8Array.from([0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20]);
class RsaTokenEngine extends pkijs.CryptoEngine {
  constructor(mode) { super({ name: "rsa-token", crypto: globalThis.crypto }); this.mode = mode; }
  async signWithPrivateKey(data) {
    const tbs = new Uint8Array(data);
    if (this.mode === "attrs") return tokenSign(tbs, "SHA256-RSA-PKCS", "02").buffer;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", tbs));
    const input = this.mode === "digestinfo" ? Uint8Array.from([...SHA256_DIGESTINFO_PREFIX, ...hash]) : hash;
    return tokenSign(input, "RSA-PKCS", "02").buffer;
  }
}

async function pathB(mode, { rsa = false } = {}) {
  const certDer = derCert(rsa ? "rsa-signer.pem" : "signer.pem");
  const cert = pkijs.Certificate.fromBER(certDer);
  const OID = { data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4" };
  const md = await crypto.subtle.digest("SHA-256", statementBytes);
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
        new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
        new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: md })] }),
      ] }),
    })],
    certificates: [cert],
  });
  // pkijs only needs the key's algorithm here; the private key never leaves the token.
  const publicKey = await crypto.subtle.importKey("spki", cert.subjectPublicKeyInfo.toSchema().toBER(false),
    rsa ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const engine = rsa ? new RsaTokenEngine(mode) : new TokenEngine(mode);
  await sd.sign(publicKey, 0, "SHA-256", statementBytes, engine);
  const ci = new pkijs.ContentInfo({ contentType: OID.signedData, content: sd.toSchema(true) });
  return { attestation: { format: ATTESTATION_FORMAT, statement, signature: toBase64(new Uint8Array(ci.toSchema().toBER(false))) } };
}

// --- Path C: external tool writes a detached .p7s ---------------------------
function pathC(certFile, keyFile, extraArgs = []) {
  const sig = execFileSync("openssl", ["cms", "-sign", "-binary", "-md", "sha256", "-outform", "DER",
    "-in", join(OUT, "statement.bin"), "-signer", join(OUT, certFile), "-inkey", join(OUT, keyFile), ...extraArgs]);
  return { attestation: { format: ATTESTATION_FORMAT, statement, signature: toBase64(new Uint8Array(sig)) } };
}

// --- Independent check with OpenSSL ----------------------------------------
function opensslVerify(attestation) {
  writeFileSync(join(OUT, "check.p7s"), fromBase64(attestation.signature));
  try {
    execFileSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-in", join(OUT, "check.p7s"),
      "-content", join(OUT, "statement.bin"), "-CAfile", join(OUT, "root.pem"), "-purpose", "any", "-out", "/dev/null"],
      { stdio: ["ignore", "ignore", "pipe"] });
    return "verified";
  } catch {
    return "failed";
  }
}

// --- Run --------------------------------------------------------------------
const rows = [];
async function check(label, expect, attestation, { g = guide, pol = "standard" } = {}) {
  const r = await verifyAttestation(g, attestation, policies[pol]);
  const got = { binding: r.binding, signature: r.signature, key_usage: r.key_usage, trust: r.trust, revocation: r.revocation, authority: r.authority, technically_valid: r.technically_valid };
  const ok = Object.entries(expect).every(([k, v]) => got[k] === v);
  rows.push({ label, ok, ...got, openssl: g === guide ? opensslVerify(attestation) : "n/a", summary: r.summary });
}

const A = await pathA();
let tokenHashAndSign = "supported";
try { await pathB("attrs"); } catch (e) {
  tokenHashAndSign = /MECHANISM_INVALID/.test(String(e.stderr)) ? "refused by token (CKR_MECHANISM_INVALID)" : `error: ${e.message}`;
}
const Bh = await pathB("hash");
const Bx = await pathB("double-hash");
const R = await pathB("attrs", { rsa: true });
const Rdi = await pathB("digestinfo", { rsa: true });
const Rbare = await pathB("bare-hash", { rsa: true });
const C = pathC("signer.pem", "signer.key", ["-nosmimecap"]);
const Cdefault = pathC("signer.pem", "signer.key");
const Cauth = pathC("auth.pem", "auth.key", ["-nosmimecap"]);
const Crev = pathC("revoked.pem", "revoked.key", ["-nosmimecap"]);

const good = { binding: "ok", signature: "valid", key_usage: "permitted", trust: "trusted", revocation: "good", authority: "not_verified", technically_valid: true };
await check("A  browser Web Crypto key", good, A.attestation);
await check("B  Imprint hashes once, token signs hash", good, Bh.attestation);
await check("B  double hash (mistake)", { signature: "invalid", technically_valid: false }, Bx.attestation);
await check("B  RSA: token hashes and signs attributes", good, R.attestation);
await check("B  RSA: Imprint builds DigestInfo, raw sign", good, Rdi.attestation);
await check("B  RSA: bare hash, no DigestInfo (mistake)", { signature: "invalid", technically_valid: false }, Rbare.attestation);
await check("C  openssl cms, minimal attributes", good, C.attestation);
await check("C  openssl cms, default attributes", good, Cdefault.attestation);
await check("C  authentication-only certificate", { signature: "valid", key_usage: "not_permitted", technically_valid: false }, Cauth.attestation);
await check("C  revoked certificate", { signature: "valid", revocation: "revoked", technically_valid: false }, Crev.attestation);
await check("A  verified against the wrong root", { trust: "untrusted", technically_valid: false }, A.attestation, { pol: "wrong anchor" });
await check("A  no CRL, policy fails closed", { revocation: "unknown", technically_valid: false }, A.attestation, { pol: "no CRL, fail" });
await check("A  no CRL, policy accepts unknown", { revocation: "unknown", technically_valid: true }, A.attestation, { pol: "no CRL, accept" });

const altered = structuredClone(guide);
altered.entries[0].description += " (edited after signing)";
await check("A  guide edited after signing", { binding: "mismatch", technically_valid: false }, A.attestation, { g: altered });

const reviewed = structuredClone(guide);
reviewed.review = { status: "complete" };
await check("A  authority review recorded afterwards", { ...good, authority: "review_complete" }, A.attestation, { g: reviewed });

console.log(`SP-03 approximated: guide ${guide.guide_id} revision ${guide.revision_id}`);
console.log(`payload digest ${digest.alg} ${digest.value}`);
console.log(`signed statement bytes: ${statementBytes.length}\n`);
for (const r of rows) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label.padEnd(42)} sig=${r.signature} keyUsage=${r.key_usage} trust=${r.trust} rev=${r.revocation} binding=${r.binding} authority=${r.authority} valid=${r.technically_valid} openssl=${r.openssl}`);
}
console.log("\nPath A notes:", JSON.stringify(A.notes));
console.log("Path B: token hash-and-sign mechanism (CKM_ECDSA_SHA256):", tokenHashAndSign);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ digest, rows, pathA: A.notes, tokenHashAndSign }, null, 2));
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} expectations met.`);
process.exitCode = failed ? 1 : 0;
