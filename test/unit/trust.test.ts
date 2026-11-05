// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadTrust } from "../../src/core/trust.ts";
import { makePki, type Pki } from "../helpers/pki.ts";

describe("trust folder", () => {
  let pki: Pki;
  let dir: string;
  before(async () => {
    pki = await makePki();
    dir = await mkdtemp(join(tmpdir(), "imprint-trust-"));
  });
  after(async () => {
    await pki.cleanup();
    await rm(dir, { recursive: true, force: true });
  });

  it("trusts nothing when the folder is empty or missing", async () => {
    const { policy, summary } = await loadTrust(join(dir, "missing"));
    assert.equal(policy.trustAnchors.length, 0);
    assert.equal(summary.unknownRevocation, "fail");
  });

  it("reads the sub-folder layout", async () => {
    const { summary } = await loadTrust(pki.trustDir);
    assert.equal(summary.anchors.length, 1);
    assert.match(summary.anchors[0]?.subject ?? "", /SYNTHETIC TEST ROOT/);
    assert.equal(summary.crls, 1);
  });

  it("reads the flat layout a Kubernetes Secret mount produces, including its symlinks", async () => {
    // A mounted Secret: real files under ..data, symlinks at the top level.
    const flat = join(dir, "flat");
    await mkdir(join(flat, "..2026_11_05"), { recursive: true });
    await writeFile(
      join(flat, "..2026_11_05", "anchor-root.pem"),
      await readFile(join(pki.trustDir, "anchors", "root.pem")),
    );
    await writeFile(
      join(flat, "..2026_11_05", "crl-root.pem"),
      await readFile(join(pki.trustDir, "crls", "root.crl.pem")),
    );
    await writeFile(join(flat, "..2026_11_05", "policy.json"), '{"unknown_revocation":"accept"}');
    await symlink("..2026_11_05", join(flat, "..data"));
    for (const name of ["anchor-root.pem", "crl-root.pem", "policy.json"])
      await symlink(join("..data", name), join(flat, name));
    const { summary } = await loadTrust(flat);
    assert.equal(summary.anchors.length, 1);
    assert.equal(summary.crls, 1);
    assert.equal(summary.unknownRevocation, "accept");
    assert.deepEqual(summary.problems, []);
  });

  it("reports unreadable files and a bad policy instead of failing", async () => {
    const bad = join(dir, "bad");
    await mkdir(join(bad, "anchors"), { recursive: true });
    await writeFile(
      join(bad, "anchors", "not-a-cert.pem"),
      "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
    );
    await writeFile(join(bad, "policy.json"), "{not json");
    const { summary } = await loadTrust(bad);
    assert.ok(summary.problems.length >= 2);
    assert.equal(summary.unknownRevocation, "fail");
  });
});
