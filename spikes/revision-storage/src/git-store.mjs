// SPDX-License-Identifier: AGPL-3.0-only
// Backend B: a Git repository written by isomorphic-git on the local disk
// (node:fs, not browser storage). Synthetic data only.
//
// Each saved draft is a commit of guide.json. A revision id is a commit id.
// Freezing writes an independent freeze record OUTSIDE Git history
// (<root>/frozen/<commit>.json, same atomic write as the snapshot backend)
// and a tag frozen/<commit-prefix>. The record, not the tag, is the authority:
// moving the tag cannot move the approval.

import * as fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import git from "isomorphic-git";
import { parseStrict, payloadBytes, payloadDigest } from "@knitli/openscg";
import { diffGuides } from "./diff.mjs";
import { atomicWriteFile } from "./atomic.mjs";


const author = { name: "Synthetic Author", email: "author@example.invalid" };

export class GitStore {
  constructor(root) {
    this.root = root;
    this.dir = join(root, "repo");
    this.frozenDir = join(root, "frozen");
  }

  async open() {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.frozenDir, { recursive: true });
    if (!fs.existsSync(join(this.dir, ".git"))) await git.init({ fs, dir: this.dir, defaultBranch: "main" });
    // isomorphic-git rewrites .git/index in place, so a crash can leave it
    // empty or truncated. The index is only a cache of the working tree: drop it
    // and let the next add rebuild it. Committed history is not affected.
    const index = join(this.dir, ".git", "index");
    if (fs.existsSync(index)) {
      try {
        await git.statusMatrix({ fs, dir: this.dir, filepaths: ["guide.json"] });
      } catch (e) {
        if (e.code !== "InternalError" && e.code !== "NotFoundError") throw e;
        fs.rmSync(index);
        return { rebuiltIndex: true, reason: e.data?.message ?? e.message };
      }
    }
    return {};
  }

  /** True when the branch file exists but does not hold a commit id (a torn write). */
  branchRefCorrupt() {
    const p = join(this.dir, ".git", "refs", "heads", "main");
    if (!fs.existsSync(p)) return false;
    return !/^[0-9a-f]{40}\n?$/.test(fs.readFileSync(p, "utf8"));
  }

  async listFreezeRecords() {
    return fs.readdirSync(this.frozenDir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).map((n) => n.slice(0, -5));
  }

  async listRevisions() {
    if (this.branchRefCorrupt()) throw new Error("branch ref refs/heads/main is empty or corrupt; history is unreachable from main");
    let commits;
    try {
      commits = await git.log({ fs, dir: this.dir, ref: "main" });
    } catch (e) {
      if (e.code === "NotFoundError") return [];
      throw e;
    }
    const frozen = new Set(fs.readdirSync(this.frozenDir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)));
    return commits.reverse().map((c) => ({ id: c.oid, frozen: frozen.has(c.oid), message: c.commit.message.trim() }));
  }

  async saveDraft(guide, message = "Save draft") {
    if (this.branchRefCorrupt()) throw new Error("refusing to commit: refs/heads/main is corrupt (would start a new, unrelated history)");
    await writeFile(join(this.dir, "guide.json"), `${JSON.stringify(guide, null, 2)}\n`);
    await git.add({ fs, dir: this.dir, filepath: "guide.json" });
    return git.commit({ fs, dir: this.dir, message, author, committer: author });
  }

  async read(oid) {
    const { blob } = await git.readBlob({ fs, dir: this.dir, oid, filepath: "guide.json" });
    return parseStrict(blob);
  }

  async freeze(oid) {
    const guide = await this.read(oid);
    const digest = await payloadDigest(guide);
    const { commit } = await git.readCommit({ fs, dir: this.dir, oid });
    await atomicWriteFile(this.frozenDir, `${oid}.payload.jcs`, await payloadBytes(guide));
    const record = { revision: oid, tree: commit.tree, guide_id: guide.guide_id, revision_id: guide.revision_id, payload_digest: digest, frozen_at: new Date().toISOString() };
    await atomicWriteFile(this.frozenDir, `${oid}.json`, new TextEncoder().encode(JSON.stringify(record, null, 2)));
    await git.tag({ fs, dir: this.dir, ref: `frozen/${oid.slice(0, 12)}`, object: oid, force: true });
    return record;
  }

  async freezeRecord(oid) {
    return JSON.parse(await readFile(join(this.frozenDir, `${oid}.json`), "utf8"));
  }

  async frozenPayload(oid) {
    return new Uint8Array(await readFile(join(this.frozenDir, `${oid}.payload.jcs`)));
  }

  async resolveTag(name) {
    return git.resolveRef({ fs, dir: this.dir, ref: `refs/tags/${name}` });
  }

  async diff(a, b) {
    return diffGuides(await this.read(a), await this.read(b));
  }
}


