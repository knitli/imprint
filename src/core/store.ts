// SPDX-License-Identifier: AGPL-3.0-only
//
// Snapshot file store (decision 0008).
//
//   <root>/guides/<key>/ref.json                      { guide_id }
//   <root>/guides/<key>/draft.json                    the working draft (replaced atomically)
//   <root>/guides/<key>/revisions/<revision_id>/guide.json   frozen canonical bytes (immutable)
//   <root>/guides/<key>/revisions/<revision_id>/freeze.json  freeze record (immutable)
//
// <key> is derived from the guide_id, so any URI can be a guide_id without
// becoming part of a file path. revision_id is checked against the OpenSCG
// local_id pattern before it is used in a path.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Digest } from "@knitli/openscg";
import { createImmutable, removeStaleTemps, replaceFile } from "./atomic.ts";

/** OpenSCG `local_id`: safe as a single path segment. */
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY = /^[0-9a-f]{32}$/;

export interface FreezeRecord {
  readonly revision_id: string;
  readonly payload_digest: Digest;
  readonly frozen_at: string;
  readonly openscg_spec: string;
}

export class StoreError extends Error {
  readonly code: "not_found" | "exists" | "bad_id";
  constructor(code: StoreError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function isLocalId(id: unknown): id is string {
  return typeof id === "string" && LOCAL_ID.test(id);
}

export function keyFor(guideId: string): string {
  return createHash("sha256").update(guideId, "utf8").digest("hex").slice(0, 32);
}

export class GuideStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private guideDir(key: string): string {
    if (!KEY.test(key)) throw new StoreError("bad_id", "Not a guide key.");
    return join(this.root, "guides", key);
  }

  private revisionDir(key: string, revisionId: string): string {
    if (!isLocalId(revisionId)) throw new StoreError("bad_id", "Not a valid revision ID.");
    return join(this.guideDir(key), "revisions", revisionId);
  }

  async init(): Promise<void> {
    await mkdir(join(this.root, "guides"), { recursive: true, mode: 0o700 });
    for (const key of await this.keys()) {
      await removeStaleTemps(this.guideDir(key));
      for (const rev of await readdir(join(this.guideDir(key), "revisions")).catch(() => [] as string[])) {
        if (!isLocalId(rev)) continue;
        await removeStaleTemps(this.revisionDir(key, rev));
        await removeStaleTemps(join(this.revisionDir(key, rev), "exports"));
      }
    }
  }

  async keys(): Promise<string[]> {
    const names = await readdir(join(this.root, "guides")).catch(() => [] as string[]);
    return names.filter((n) => KEY.test(n)).sort();
  }

  async exists(key: string): Promise<boolean> {
    return stat(join(this.guideDir(key), "ref.json")).then(
      () => true,
      () => false,
    );
  }

  /** Create the folder for a new guide. Fails if a guide with this ID exists. */
  async create(guideId: string, draftBytes: string): Promise<string> {
    const key = keyFor(guideId);
    const dir = this.guideDir(key);
    await mkdir(join(dir, "revisions"), { recursive: true, mode: 0o700 });
    try {
      await createImmutable(join(dir, "ref.json"), `${JSON.stringify({ guide_id: guideId })}\n`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new StoreError("exists", "A guide with this ID already exists.");
      }
      throw e;
    }
    await replaceFile(join(dir, "draft.json"), draftBytes);
    return key;
  }

  async readDraft(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(join(this.guideDir(key), "draft.json")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new StoreError("not_found", "No such guide.");
      throw e;
    }
  }

  async writeDraft(key: string, draftBytes: string): Promise<void> {
    if (!(await this.exists(key))) throw new StoreError("not_found", "No such guide.");
    await replaceFile(join(this.guideDir(key), "draft.json"), draftBytes);
  }

  /**
   * Store a frozen revision. The guide bytes are written first and the freeze
   * record last, so a revision only counts as frozen once both exist.
   */
  async freeze(key: string, record: FreezeRecord, canonicalGuide: Uint8Array): Promise<void> {
    const dir = this.revisionDir(key, record.revision_id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await createImmutable(join(dir, "guide.json"), canonicalGuide);
      await createImmutable(join(dir, "freeze.json"), `${JSON.stringify(record, null, 2)}\n`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new StoreError("exists", `Revision ${record.revision_id} is already frozen.`);
      }
      throw e;
    }
  }

  async isFrozen(key: string, revisionId: string): Promise<boolean> {
    if (!isLocalId(revisionId)) return false;
    return stat(join(this.revisionDir(key, revisionId), "freeze.json")).then(
      () => true,
      () => false,
    );
  }

  async listRevisions(key: string): Promise<FreezeRecord[]> {
    const dir = join(this.guideDir(key), "revisions");
    const out: FreezeRecord[] = [];
    for (const rev of await readdir(dir).catch(() => [] as string[])) {
      if (!isLocalId(rev)) continue;
      const raw = await readFile(join(dir, rev, "freeze.json"), "utf8").catch(() => null);
      if (raw) out.push(JSON.parse(raw) as FreezeRecord);
    }
    return out.sort((a, b) => a.frozen_at.localeCompare(b.frozen_at));
  }

  /** Exported files of a frozen revision. Written once, so released bytes never change. */
  static readonly EXPORT_NAMES = new Set(["guide.pdf", "guide.xlsx", "release-manifest.json", "release.zip"]);

  private exportPath(key: string, revisionId: string, name: string): string {
    if (!GuideStore.EXPORT_NAMES.has(name)) throw new StoreError("bad_id", "Not an export name.");
    return join(this.revisionDir(key, revisionId), "exports", name);
  }

  async readExport(key: string, revisionId: string, name: string): Promise<Uint8Array | null> {
    return readFile(this.exportPath(key, revisionId, name)).then(
      (b) => new Uint8Array(b),
      () => null,
    );
  }

  /** Store an export, or return the one already stored if another request got there first. */
  async writeExport(key: string, revisionId: string, name: string, bytes: Uint8Array): Promise<Uint8Array> {
    const path = this.exportPath(key, revisionId, name);
    await mkdir(join(this.revisionDir(key, revisionId), "exports"), { recursive: true, mode: 0o700 });
    try {
      await createImmutable(path, bytes);
      return bytes;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return new Uint8Array(await readFile(path));
      throw e;
    }
  }

  async readRevision(key: string, revisionId: string): Promise<{ record: FreezeRecord; guide: Uint8Array }> {
    const dir = this.revisionDir(key, revisionId);
    try {
      const record = JSON.parse(await readFile(join(dir, "freeze.json"), "utf8")) as FreezeRecord;
      const guide = new Uint8Array(await readFile(join(dir, "guide.json")));
      return { record, guide };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new StoreError("not_found", "No such revision.");
      throw e;
    }
  }
}
