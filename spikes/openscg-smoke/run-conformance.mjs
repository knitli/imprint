// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike: run the OpenSCG 0.1.0 conformance procedure (spec/conformance.md,
// sections 2-5) against the published @knitli/openscg package, using only the
// files that ship inside the package. Synthetic data only.
//
// This does not test Imprint. It tells us whether the dependency we plan to
// build on behaves as its specification says, in our toolchain.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  canonicalize,
  fromPem,
  isApprovalReady,
  parseStrict,
  payloadBytes,
  payloadDigest,
  approvalStatementBytes,
  buildApprovalStatement,
  SPEC_VERSION,
  StrictParseError,
  validate,
  validateStructure,
  verifyAttestation,
} from "@knitli/openscg";

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve("@knitli/openscg/package.json"));
const bytes = (p) => readFile(p).then((b) => new Uint8Array(b));
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const equalBytes = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const results = [];
function record(section, id, ok, detail = "") {
  results.push({ section, id, ok, detail });
}

// Section 2: parsing and canonicalization
{
  const dir = join(pkgRoot, "conformance/vectors/canonical");
  const m = await json(join(dir, "manifest.json"));
  for (const c of m.valid) {
    try {
      const out = canonicalize(parseStrict(await bytes(join(dir, c.input))));
      const want = await bytes(join(dir, c.expected));
      record("2-canonical", c.id, equalBytes(out, want));
    } catch (e) {
      record("2-canonical", c.id, false, String(e));
    }
  }
  for (const c of m.invalid) {
    try {
      parseStrict(await bytes(join(dir, c.input)));
      record("2-canonical", c.id, false, "parsed but should have failed");
    } catch (e) {
      const ok = e instanceof StrictParseError && e.code === c.error;
      record("2-canonical", c.id, ok, ok ? "" : `got ${e.code ?? e}`);
    }
  }
}

// Section 3: payload and statement bytes
{
  const dir = join(pkgRoot, "conformance/vectors/payload");
  const m = await json(join(dir, "manifest.json"));
  for (const c of m.cases) {
    try {
      const guide = parseStrict(await bytes(join(dir, c.guide)));
      const payload = await payloadBytes(guide);
      const want = await bytes(join(dir, c.payload));
      const digest = await payloadDigest(guide);
      let ok = equalBytes(payload, want) && digest.value === c.payload_digest.value;
      if (c.statement) {
        const stmt = approvalStatementBytes(
          await buildApprovalStatement(guide, guide.authority?.claimed_signer),
        );
        ok = ok && equalBytes(stmt, await bytes(join(dir, c.statement)));
      }
      record("3-payload", c.id, ok);
    } catch (e) {
      record("3-payload", c.id, false, String(e));
    }
  }
}

// Section 4: validation
{
  const dir = join(pkgRoot, "conformance");
  const m = await json(join(dir, "manifest.json"));
  for (const c of m.cases) {
    const raw = await bytes(join(dir, c.file));
    let doc;
    try {
      doc = parseStrict(raw);
    } catch (e) {
      const ok = c.expected.parse_error === e.code;
      record("4-validation", c.id, ok, ok ? "" : `parse error ${e.code}`);
      continue;
    }
    if (c.expected.parse_error) {
      record("4-validation", c.id, false, "expected parse error");
      continue;
    }
    const structural = validateStructure(doc);
    const structure = structural.length === 0 ? "valid" : "invalid";
    if (structure !== c.expected.structure) {
      record("4-validation", c.id, false, `structure ${structure}`);
      continue;
    }
    const findings = validate(doc);
    let ok = isApprovalReady(findings) === c.expected.approval_ready;
    if (structure === "valid" && c.expected.findings) {
      const key = (f) => `${f.code} ${f.pointer}`;
      const got = new Set(findings.map(key));
      const want = new Set(c.expected.findings.map(key));
      ok = ok && got.size === want.size && [...want].every((k) => got.has(k));
    }
    record("4-validation", c.id, ok, ok ? "" : JSON.stringify(findings.map((f) => [f.code, f.pointer])));
  }
}

// Section 5: attestation verification
{
  const dir = join(pkgRoot, "conformance/vectors/attestation");
  const m = await json(join(dir, "manifest.json"));
  const pems = async (files, label) =>
    (await Promise.all((files ?? []).map((f) => readFile(join(dir, f), "utf8"))))
      .flatMap((p) => fromPem(p, label));
  for (const c of m.cases) {
    try {
      const guide = parseStrict(await bytes(join(dir, c.guide)));
      const report = await verifyAttestation(guide, guide.attestations[0], {
        trustAnchors: await pems(c.trust_anchors, "CERTIFICATE"),
        crls: await pems(c.crls, "X509 CRL"),
        time: new Date(m.verify_at),
        unknownRevocation: c.unknown_revocation ?? "fail",
      });
      const diffs = Object.entries(c.expected).filter(([k, v]) => report[k] !== v);
      record("5-attestation", c.id, diffs.length === 0, diffs.map(([k]) => `${k}=${report[k]}`).join(", "));
    } catch (e) {
      record("5-attestation", c.id, false, String(e));
    }
  }
}

// Report
console.log(`@knitli/openscg spec ${SPEC_VERSION} — conformance smoke run (synthetic data only)\n`);
const sections = [...new Set(results.map((r) => r.section))];
for (const s of sections) {
  const rs = results.filter((r) => r.section === s);
  console.log(`${s}: ${rs.filter((r) => r.ok).length}/${rs.length} passed`);
  for (const r of rs.filter((r) => !r.ok)) console.log(`  FAIL ${r.id} ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} cases passed.`);
process.exitCode = failed ? 1 : 0;
