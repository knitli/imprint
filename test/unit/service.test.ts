// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { canonicalize, parseStrict, payloadDigest } from "@knitli/openscg";
import { type GuideService, ServiceError } from "../../src/core/service.ts";
import {
  fixture,
  fixtureBytes,
  LANTERN,
  LANTERN_REVIEWED,
  SIGNED,
  SIGNED_ALTERED,
  tempService,
} from "../helpers/fixtures.ts";

const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;

describe("GuideService", () => {
  let service: GuideService;
  let cleanup: () => Promise<void>;
  before(async () => {
    ({ service, cleanup } = await tempService());
  });
  after(() => cleanup());

  it("starts a structurally valid draft that asks for the missing parts", async () => {
    const key = await service.create({
      title: "Synthetic test",
      classification: "U",
      profile: "cnsi-core",
      synthetic: true,
    });
    const view = await service.get(key);
    assert.equal(view.frozen, false);
    const codes = view.findings.map((f) => f.code);
    assert.ok(!codes.includes("OSCG-S000"), "a new draft must not have structural errors");
    for (const c of ["OSCG-V011", "OSCG-V040", "OSCG-V041", "OSCG-V042", "OSCG-V046"])
      assert.ok(codes.includes(c), c);
    assert.equal(view.approvalReady, false);
  });

  it("saves a draft with errors (requirements §3 step 3)", async () => {
    const key = await service.create({
      title: "With errors",
      classification: "U",
      profile: "cnsi-core",
      synthetic: true,
    });
    const view = await service.get(key);
    const saved = await service.saveDraft(key, {
      ...view.doc,
      entries: [{ entry_id: "x", kind: "element", description: "Synthetic", level: "S" }],
    });
    assert.ok(saved.findings.some((f) => f.code === "OSCG-V010" && f.pointer === "/entries/0/reason"));
  });

  it("will not freeze a draft that is not approval-ready", async () => {
    const key = await service.create({
      title: "Not ready",
      classification: "U",
      profile: "cnsi-core",
      synthetic: true,
    });
    await assert.rejects(service.freeze(key), code("not_ready"));
  });

  it("freezes LANTERN to the published payload digest and keeps those bytes", async () => {
    const { key } = await service.importGuide(await fixtureBytes(LANTERN_REVIEWED));
    const expected = await payloadDigest((await fixture(LANTERN_REVIEWED)) as never);
    const record = await service.freeze(key);
    assert.deepEqual(record.payload_digest, expected);
    const rev = await service.revision(key, record.revision_id);
    assert.deepEqual(await payloadDigest(parseStrict(rev.bytes) as never), expected);

    // A frozen revision cannot be edited.
    const view = await service.get(key);
    assert.equal(view.frozen, true);
    await assert.rejects(service.saveDraft(key, view.doc), code("conflict"));

    // A new revision links back and the old bytes are untouched (M-01).
    const before = createHash("sha256").update(rev.bytes).digest("hex");
    const next = await service.newRevision(key, "2026-r2");
    assert.equal(next.frozen, false);
    assert.equal(next.doc.revision_id, "2026-r2");
    const history = next.doc.history as {
      previous_revisions: { revision_id: string; payload_digest: unknown }[];
    };
    // parseStrict returns objects without a prototype, so compare plain copies.
    assert.deepEqual(JSON.parse(JSON.stringify(history.previous_revisions.at(-1))), {
      revision_id: "2026-r1",
      payload_digest: expected,
    });
    assert.equal((next.doc.document_markings as { review: { status: string } }).review.status, "pending");
    const again = await service.revision(key, "2026-r1");
    assert.equal(createHash("sha256").update(again.bytes).digest("hex"), before);
    await assert.rejects(service.newRevision(key, "2026-r3"), code("conflict"));
    await assert.rejects(service.saveDraft(key, { ...next.doc, revision_id: "2026-r1" }), code("conflict"));
  });

  it("imports a file without changing it", async () => {
    const original = await fixture(LANTERN);
    const { service: s2, cleanup: c2 } = await tempService();
    try {
      const result = await s2.importGuide(await fixtureBytes(LANTERN));
      assert.deepEqual(result.loss.items, []);
      assert.equal(result.importedAsFrozen, false);
      const view = await s2.get(result.key);
      assert.deepEqual(canonicalize(view.doc), canonicalize(original));
    } finally {
      await c2();
    }
  });

  it("refuses unsafe or duplicate imports", async () => {
    await assert.rejects(service.importGuide(new TextEncoder().encode('{"a":1,"a":2}')), code("bad_input"));
    await assert.rejects(service.importGuide(new TextEncoder().encode("[1]")), code("bad_input"));
    await assert.rejects(service.importGuide(await fixtureBytes(LANTERN_REVIEWED)), code("conflict"));
  });

  it("imports a signed file as frozen, and refuses one changed after signing (M-08)", async () => {
    const a = await tempService();
    const b = await tempService();
    try {
      const ok = await a.service.importGuide(await fixtureBytes(SIGNED));
      assert.equal(ok.importedAsFrozen, true);
      assert.equal((await a.service.get(ok.key)).frozen, true);
      await assert.rejects(b.service.importGuide(await fixtureBytes(SIGNED_ALTERED)), code("rejected"));
      assert.deepEqual(await b.service.list(), []);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  it("in demo mode accepts only synthetic guides (M-13)", async () => {
    const demo = await tempService(true);
    try {
      await assert.rejects(
        demo.service.create({ title: "Real?", classification: "U", profile: "cnsi-core", synthetic: false }),
        code("rejected"),
      );
      const notSynthetic = { ...(await fixture(LANTERN)) };
      delete notSynthetic.synthetic;
      await assert.rejects(
        demo.service.importGuide(new TextEncoder().encode(JSON.stringify(notSynthetic))),
        code("rejected"),
      );
      const key = await demo.service.create({
        title: "Fine",
        classification: "U",
        profile: "cnsi-core",
        synthetic: true,
      });
      const view = await demo.service.get(key);
      const { synthetic: _, ...rest } = view.doc;
      await assert.rejects(demo.service.saveDraft(key, rest), code("rejected"));
    } finally {
      await demo.cleanup();
    }
  });
});
