// SPDX-License-Identifier: AGPL-3.0-only
//
// M-09, M-10: sign a frozen revision with an existing credential, verify it
// independently, and keep technical, trust and authority results separate.
// Synthetic PKI and data only. See test/helpers/pki.ts.
//
// The PKCS#11 tests use SoftHSM2 and OpenSC, the acceptance environment named
// in decision 0009. CI sets IMPRINT_REQUIRE_PKCS11=1 so they cannot be skipped.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { payloadDigest, verifyAttestation } from "@knitli/openscg";
import { ExportService } from "../../src/core/exports.ts";
import type { GuideService } from "../../src/core/service.ts";
import { headline, readSignature, SigningService } from "../../src/core/signing.ts";
import { fixture, fixtureBytes, LANTERN_REVIEWED, SIGNED, tempService } from "../helpers/fixtures.ts";
import { hasSoftHsm, makePki, type Pki, SOFTHSM_MODULE } from "../helpers/pki.ts";

const run = promisify(execFile);
const rejected = (e: unknown) => (e as { code?: string }).code === "rejected";

describe("signing and verification", () => {
  let pki: Pki;
  let service: GuideService;
  let cleanup: () => Promise<void>;
  let signing: SigningService;
  let key: string;
  const rev = "2026-r1";

  before(async () => {
    pki = await makePki();
    ({ service, cleanup } = await tempService());
    signing = new SigningService(service, new ExportService(service), pki.trustDir);
    ({ key } = await service.importGuide(await fixtureBytes(LANTERN_REVIEWED)));
    await service.freeze(key);
  });
  after(async () => {
    await cleanup();
    await pki.cleanup();
  });

  it("gives out the exact approval statement bytes for the frozen revision", async () => {
    const { statement, bytes } = await signing.statement(key, rev);
    assert.equal(statement.revision_id, rev);
    assert.deepEqual(
      JSON.parse(JSON.stringify(statement.payload_digest)),
      await payloadDigest((await fixture(LANTERN_REVIEWED)) as never),
    );
    assert.ok(new TextDecoder().decode(bytes).startsWith("OpenSCG-Approval-Statement-v1\n"));
  });

  it("accepts a signature from an external tool and reports 'signature valid; authority not verified'", async () => {
    const { bytes } = await signing.statement(key, rev);
    const { added } = await signing.addSignature(key, rev, await pki.sign("signer", bytes));
    assert.equal(added, true);
    const [view] = await signing.attestations(key, rev);
    assert.ok(view);
    assert.equal(view.report.technically_valid, true);
    assert.equal(view.report.trust, "trusted");
    assert.equal(view.report.revocation, "good");
    assert.equal(view.report.authority, "not_verified");
    assert.equal(headline(view.report, false), "Signature valid; authority not verified.");
  });

  it("stores the same signature only once", async () => {
    const { bytes } = await signing.statement(key, rev);
    const sig = await pki.sign("signer", bytes);
    await signing.addSignature(key, rev, sig);
    assert.equal((await signing.addSignature(key, rev, sig)).added, false);
  });

  it("accepts PEM and base64 as well as DER, and an RSA signer", async () => {
    const { bytes } = await signing.statement(key, rev);
    await signing.addSignature(key, rev, await pki.sign("rsaSigner", bytes, "PEM"));
    const der = await pki.sign("signer", bytes);
    assert.equal(
      readSignature(new TextEncoder().encode(Buffer.from(der).toString("base64"))),
      Buffer.from(der).toString("base64"),
    );
    const views = await signing.attestations(key, rev);
    assert.ok(views.length >= 2);
    assert.ok(views.every((v) => v.report.technically_valid));
  });

  it("refuses a signature over anything else, or a damaged one", async () => {
    await assert.rejects(
      signing.addSignature(key, rev, await pki.sign("signer", new TextEncoder().encode("other bytes"))),
      rejected,
    );
    const { bytes } = await signing.statement(key, rev);
    const good = await pki.sign("signer", bytes);
    const bad = good.slice();
    bad[bad.length - 10] = (bad[bad.length - 10] ?? 0) ^ 0xff;
    await assert.rejects(signing.addSignature(key, rev, bad), rejected);
    await assert.rejects(
      signing.addSignature(key, rev, new TextEncoder().encode("not a signature")),
      (e: unknown) => (e as { code?: string }).code === "bad_input",
    );
  });

  it("keeps but rejects a login-only or revoked certificate, each for its own reason", async () => {
    const { bytes } = await signing.statement(key, rev);
    const a = await signing.addSignature(key, rev, await pki.sign("auth", bytes));
    const r = await signing.addSignature(key, rev, await pki.sign("revoked", bytes));
    const views = await signing.attestations(key, rev);
    const auth = views.find((v) => v.id === a.id);
    const revoked = views.find((v) => v.id === r.id);
    assert.equal(auth?.report.key_usage, "not_permitted");
    assert.equal(auth?.report.technically_valid, false);
    assert.equal(revoked?.report.revocation, "revoked");
    assert.equal(revoked?.report.technically_valid, false);
    assert.equal(
      headline(revoked?.report as never, false),
      "Signature not valid under this system's trust policy.",
    );
  });

  it("does not trust a signer whose root is not a local trust anchor", async () => {
    const other = new SigningService(service, new ExportService(service), pki.otherTrustDir);
    const views = await other.attestations(key, rev);
    assert.ok(views.length > 0);
    assert.ok(views.every((v) => v.report.trust === "untrusted" && !v.report.technically_valid));
    const none = new SigningService(service, new ExportService(service), join(pki.dir, "no-such-folder"));
    assert.ok((await none.attestations(key, rev)).every((v) => !v.report.technically_valid));
  });

  it("records a human authority review separately, without touching the signature (M-10)", async () => {
    await signing.saveReview(key, rev, {
      status: "complete",
      reviewed_by: "Pat Reviewer (fictional)",
      reviewed_on: "2026-11-05",
    });
    const views = await signing.attestations(key, rev);
    const good = views.find((v) => v.report.technically_valid);
    assert.equal(good?.report.authority, "review_complete");
    assert.equal(
      headline(good?.report as never, false),
      "Signature valid; a human authority review is recorded as complete.",
    );
    // The frozen bytes are unchanged by the review.
    const frozen = await service.revision(key, rev);
    assert.equal(JSON.parse(new TextDecoder().decode(frozen.bytes)).review, undefined);
  });

  it("exports a signed guide that any OpenSCG verifier accepts, and lists signatures in the manifest", async () => {
    const signed = JSON.parse(new TextDecoder().decode(await signing.signedGuide(key, rev)));
    assert.ok(signed.attestations.length > 0);
    const root = await readFile(pki.cert("signer").replace("signer.pem", "root.pem"), "utf8");
    const { fromPem } = await import("@knitli/openscg");
    const report = await verifyAttestation(signed, signed.attestations[0], {
      trustAnchors: fromPem(root, "CERTIFICATE"),
    });
    assert.equal(report.binding, "ok");
    assert.equal(report.signature, "valid");
    const { manifest } = await signing.manifest(key, rev);
    assert.ok(manifest.files.some((f) => f.role === "attestation"));
  });

  it("verifies a signed release manifest against the released files", async () => {
    const { bytes } = await signing.manifest(key, rev);
    await signing.addManifestSignature(key, rev, await pki.sign("signer", bytes));
    const [m] = await signing.manifestSignatures(key, rev);
    assert.equal(m?.report.technically_valid, true);
    assert.ok(m?.report.files.every((f) => f.status === "ok"));
    await assert.rejects(
      signing.addManifestSignature(key, rev, await pki.sign("signer", new TextEncoder().encode("x"))),
      rejected,
    );
  });

  it("explains when a revision names no expected signer", async () => {
    const doc = await fixture(LANTERN_REVIEWED);
    delete doc.authority;
    doc.guide_id = "urn:uuid:5e1d0c3a-0000-4000-8000-00000000b001";
    const { key: k2 } = await service.importGuide(new TextEncoder().encode(JSON.stringify(doc)));
    await service.freeze(k2);
    await assert.rejects(
      signing.statement(k2, rev),
      (e: unknown) => (e as { code?: string }).code === "not_ready",
    );
  });

  it("keeps the signatures and review of an imported signed file", async () => {
    const t = await tempService();
    try {
      const imported = await t.service.importGuide(await fixtureBytes(SIGNED));
      const s = new SigningService(t.service, new ExportService(t.service), pki.trustDir);
      const views = await s.attestations(imported.key, "2026-r1");
      assert.equal(views.length, 1);
      assert.equal(views[0]?.report.binding, "ok");
      assert.equal(views[0]?.report.signature, "valid");
    } finally {
      await t.cleanup();
    }
  });
});

const softhsm = await hasSoftHsm();
const pkcs11Skip = softhsm
  ? false
  : process.env.IMPRINT_REQUIRE_PKCS11
    ? false
    : "SoftHSM2 and OpenSC not installed";

describe("imprint-sign with a PKCS#11 token (SoftHSM2, decision 0009)", { skip: pkcs11Skip }, () => {
  let pki: Pki;
  let tokenDir: string;
  let env: NodeJS.ProcessEnv;
  let service: GuideService;
  let cleanup: () => Promise<void>;
  let signing: SigningService;
  let key: string;
  const rev = "2026-r1";

  before(async () => {
    pki = await makePki();
    tokenDir = await mkdtemp(join(tmpdir(), "imprint-softhsm-"));
    await mkdir(join(tokenDir, "tokens"));
    await writeFile(
      join(tokenDir, "softhsm2.conf"),
      `directories.tokendir = ${join(tokenDir, "tokens")}\nobjectstore.backend = file\nlog.level = ERROR\n`,
    );
    env = { ...process.env, SOFTHSM2_CONF: join(tokenDir, "softhsm2.conf") };
    await run(
      "softhsm2-util",
      ["--init-token", "--free", "--label", "SYNTHETIC-CARD", "--so-pin", "87654321", "--pin", "123456"],
      { env },
    );
    for (const [name, id] of [
      ["signer", "01"],
      ["rsaSigner", "02"],
    ] as const) {
      await run("openssl", [
        "pkcs8",
        "-topk8",
        "-nocrypt",
        "-in",
        pki.key(name),
        "-out",
        join(tokenDir, `${id}.p8`),
      ]);
      await run(
        "softhsm2-util",
        [
          "--import",
          join(tokenDir, `${id}.p8`),
          "--token",
          "SYNTHETIC-CARD",
          "--label",
          name,
          "--id",
          id,
          "--pin",
          "123456",
        ],
        { env },
      );
      await rm(join(tokenDir, `${id}.p8`));
    }
    // Put the EC signer's certificate on the token too, so imprint-sign can read it from there.
    await run("openssl", [
      "x509",
      "-in",
      pki.cert("signer"),
      "-outform",
      "DER",
      "-out",
      join(tokenDir, "01.der"),
    ]);
    await run(
      "pkcs11-tool",
      [
        "--module",
        SOFTHSM_MODULE,
        "--login",
        "--pin",
        "123456",
        "--write-object",
        join(tokenDir, "01.der"),
        "--type",
        "cert",
        "--id",
        "01",
      ],
      { env },
    );

    ({ service, cleanup } = await tempService());
    signing = new SigningService(service, new ExportService(service), pki.trustDir);
    ({ key } = await service.importGuide(await fixtureBytes(LANTERN_REVIEWED)));
    await service.freeze(key);
  });
  after(async () => {
    await cleanup();
    await pki.cleanup();
    await rm(tokenDir, { recursive: true, force: true });
  });

  async function signWithToken(id: string, cert?: string): Promise<Uint8Array> {
    const { bytes } = await signing.statement(key, rev);
    const input = join(tokenDir, `statement-${id}.bin`);
    const output = join(tokenDir, `statement-${id}.p7s`);
    await writeFile(input, bytes);
    await rm(output, { force: true });
    const args = [
      "bin/imprint-sign.ts",
      "--module",
      SOFTHSM_MODULE,
      "--id",
      id,
      "--in",
      input,
      "--out",
      output,
    ];
    if (cert) args.push("--cert", cert);
    // A real token's middleware asks for the PIN. This throwaway test token gets it on the command line,
    // which imprint-sign refuses unless explicitly allowed for tests.
    args.push("--", "--pin", "123456");
    await run("node", args, { env: { ...env, IMPRINT_SIGN_ALLOW_PIN_ARG: "1" } });
    return new Uint8Array(await readFile(output));
  }

  it("signs with an EC key, reading the certificate from the token", async () => {
    await signing.addSignature(key, rev, await signWithToken("01"));
    const views = await signing.attestations(key, rev);
    assert.ok(
      views.some(
        (v) => v.report.technically_valid && /SYNTHETIC OCA SIGNER/.test(v.report.signer_subject ?? ""),
      ),
    );
  });

  it("signs with an RSA key", async () => {
    await signing.addSignature(key, rev, await signWithToken("02", pki.cert("rsaSigner")));
    const views = await signing.attestations(key, rev);
    assert.ok(
      views.some((v) => v.report.technically_valid && /RSA SIGNER/.test(v.report.signer_subject ?? "")),
    );
  });

  it("refuses to take a PIN on the command line unless a test allows it", async () => {
    await assert.rejects(
      run(
        "node",
        [
          "bin/imprint-sign.ts",
          "--module",
          SOFTHSM_MODULE,
          "--id",
          "01",
          "--in",
          "x",
          "--out",
          "y",
          "--",
          "--pin",
          "123456",
        ],
        { env },
      ),
      (e: unknown) => /do not put a PIN on the command line/.test(String((e as { stderr?: string }).stderr)),
    );
  });
});
