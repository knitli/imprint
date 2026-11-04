// SPDX-License-Identifier: AGPL-3.0-only
// Backend A: immutable snapshot files on the local disk. Synthetic data only.
//
// Layout under <root>:
//   revisions/<seq>-<hash12>.json   one immutable file per saved draft
//   frozen/<revision>.payload.jcs   canonical payload bytes of a frozen revision
//   frozen/<revision>.json          freeze record (the commit point)
// Every file is written to a temp name, fsynced, renamed into place, and the
// directory is fsynced. Readers ignore temp files; open() deletes them.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize, parseStrict, payloadBytes, payloadDigest } from "@knitli/openscg";
import { atomicWriteFile, isTemp } from "./atomic.mjs";
import { diffGuides } from "./diff.mjs";

const enc = new TextEncoder();
const atomicWrite = atomicWriteFile;

export class SnapshotStore {
  constructor(root) {
    this.root = root;
    this.revDir = join(root, "revisions");
    this.frozenDir = join(root, "frozen");
  }

  /** Create folders and remove temp files left by an interrupted write. */
  async open() {
    let removed = 0;
    for (const d of [this.revDir, this.frozenDir]) {
      await mkdir(d, { recursive: true });
      for (const n of await readdir(d)) {
        if (isTemp(n)) {
          await rm(join(d, n));
          removed++;
        }
      }
    }
    return { removedTempFiles: removed };
  }

  async listRevisions() {
    const names = (await readdir(this.revDir)).filter((n) => n.endsWith(".json") && !isTemp(n)).sort();
    const frozen = new Set((await readdir(this.frozenDir)).filter((n) => n.endsWith(".json") && !isTemp(n)).map((n) => n.slice(0, -5)));
    return names.map((n) => {
      const id = n.slice(0, -5);
      return { id, frozen: frozen.has(id) };
    });
  }

  /** Save a draft as a new immutable revision. Returns its id. */
  async saveDraft(guide, message = "") {
    const revs = await this.listRevisions();
    const seq = revs.length ? Number.parseInt(revs.at(-1).id.split("-")[0], 10) + 1 : 1;
    const record = { parent: revs.at(-1)?.id ?? null, message, saved_at: new Date().toISOString(), guide };
    const bytes = canonicalize(record);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const id = `${String(seq).padStart(6, "0")}-${hash}`;
    await atomicWrite(this.revDir, `${id}.json`, bytes);
    return id;
  }

  async readRecord(id) {
    return parseStrict(await readFile(join(this.revDir, `${id}.json`)));
  }

  async read(id) {
    return (await this.readRecord(id)).guide;
  }

  /** Freeze a revision: store its canonical payload bytes, then the freeze record. */
  async freeze(id) {
    const guide = await this.read(id);
    const payload = await payloadBytes(guide);
    const digest = await payloadDigest(guide);
    await atomicWrite(this.frozenDir, `${id}.payload.jcs`, payload);
    const record = { revision: id, guide_id: guide.guide_id, revision_id: guide.revision_id, payload_digest: digest, frozen_at: new Date().toISOString() };
    await atomicWrite(this.frozenDir, `${id}.json`, enc.encode(JSON.stringify(record, null, 2)));
    return record;
  }

  async listFreezeRecords() {
    return (await readdir(this.frozenDir)).filter((n) => n.endsWith(".json") && !isTemp(n)).map((n) => n.slice(0, -5));
  }

  async freezeRecord(id) {
    return JSON.parse(await readFile(join(this.frozenDir, `${id}.json`), "utf8"));
  }

  async frozenPayload(id) {
    return new Uint8Array(await readFile(join(this.frozenDir, `${id}.payload.jcs`)));
  }

  async diff(a, b) {
    return diffGuides(await this.read(a), await this.read(b));
  }
}
