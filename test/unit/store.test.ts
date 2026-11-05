// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { GuideStore, keyFor, StoreError } from "../../src/core/store.ts";

describe("GuideStore", () => {
  let dir: string;
  let store: GuideStore;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "imprint-store-"));
    store = new GuideStore(dir);
    await store.init();
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("creates a guide under a key derived from its ID", async () => {
    const key = await store.create("urn:uuid:test-1", '{"a":1}\n');
    assert.equal(key, keyFor("urn:uuid:test-1"));
    assert.equal(new TextDecoder().decode(await store.readDraft(key)), '{"a":1}\n');
  });

  it("refuses a second guide with the same ID", async () => {
    await assert.rejects(
      store.create("urn:uuid:test-1", "{}"),
      (e: unknown) => e instanceof StoreError && e.code === "exists",
    );
  });

  it("replaces the draft and leaves no temporary files", async () => {
    const key = keyFor("urn:uuid:test-1");
    await store.writeDraft(key, '{"a":2}\n');
    assert.equal(new TextDecoder().decode(await store.readDraft(key)), '{"a":2}\n');
    const names = await readdir(join(dir, "guides", key));
    assert.deepEqual(
      names.filter((n) => n.startsWith(".tmp-")),
      [],
    );
  });

  it("never overwrites a frozen revision", async () => {
    const key = keyFor("urn:uuid:test-1");
    const record = {
      revision_id: "r1",
      payload_digest: { alg: "sha-256" as const, value: "00" },
      frozen_at: "2026-11-05T00:00:00Z",
      openscg_spec: "0.1.0",
    };
    await store.freeze(key, record, new TextEncoder().encode("first"));
    await assert.rejects(
      store.freeze(key, record, new TextEncoder().encode("second")),
      (e: unknown) => e instanceof StoreError && e.code === "exists",
    );
    const { guide } = await store.readRevision(key, "r1");
    assert.equal(new TextDecoder().decode(guide), "first");
    assert.equal(await store.isFrozen(key, "r1"), true);
    assert.equal(await store.isFrozen(key, "r2"), false);
  });

  it("rejects revision IDs that are not safe path segments", async () => {
    const key = keyFor("urn:uuid:test-1");
    for (const bad of ["../x", "..", "a/b", "", ".hidden"]) {
      await assert.rejects(
        store.readRevision(key, bad),
        (e: unknown) => e instanceof StoreError && e.code === "bad_id",
      );
    }
    await assert.rejects(
      store.readDraft("../../etc"),
      (e: unknown) => e instanceof StoreError && e.code === "bad_id",
    );
  });

  it("removes temporary files left by a crash when it starts", async () => {
    const key = keyFor("urn:uuid:test-1");
    await writeFile(join(dir, "guides", key, ".tmp-draft.json.abc123"), "half written");
    await store.init();
    const names = await readdir(join(dir, "guides", key));
    assert.ok(!names.some((n) => n.startsWith(".tmp-")));
    assert.equal(await readFile(join(dir, "guides", key, "draft.json"), "utf8"), '{"a":2}\n');
  });
});
