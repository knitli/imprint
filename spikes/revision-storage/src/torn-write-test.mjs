// SPDX-License-Identifier: AGPL-3.0-only
// SP-02 torn-write test: put the on-disk state a crash or power loss can
// leave behind in place on purpose, then see what each backend does.
// Synthetic data only.

import * as fs from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { GitStore } from "./git-store.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { lantern, SCRATCH } from "./fixtures.mjs";
import { verifyStore } from "./verify.mjs";

const rows = [];
const row = (backend, fault, result) => rows.push({ backend, fault, result });
const tryRead = async (store, id) => {
  try {
    await store.read(id);
    return "reads fine";
  } catch (e) {
    return `read fails (${e.code ?? e.message.slice(0, 60)})`;
  }
};

// ---------- snapshot ----------
{
  const root = join(SCRATCH, "torn-snapshot");
  fs.rmSync(root, { recursive: true, force: true });
  const s = new SnapshotStore(root);
  await s.open();
  const g = await lantern();
  const r1 = await s.saveDraft(g, "one");
  // 1. Crash mid-write: a half-written temp file is left behind.
  fs.writeFileSync(join(s.revDir, `.000002-deadbeef.json.123.tmp`), '{"guide":{"entr');
  const opened = await new SnapshotStore(root).open();
  row("snapshot", "half-written temp file left by a crash", `ignored by readers; open() removed ${opened.removedTempFiles}; revisions listed: ${(await s.listRevisions()).length}`);
  // 2. A file under its final name is truncated (should not happen with
  //    fsync + rename on a journaling file system; checks that it is not silently accepted).
  const p = join(s.revDir, `${r1}.json`);
  const full = fs.readFileSync(p);
  fs.writeFileSync(p, full.subarray(0, 100));
  row("snapshot", "final file truncated (file system misbehaved)", `${await tryRead(s, r1)}; verify reports ${(await verifyStore(s)).issues.length} issue(s)`);
  fs.writeFileSync(p, full);
}

// ---------- git ----------
{
  const root = join(SCRATCH, "torn-git");
  fs.rmSync(root, { recursive: true, force: true });
  const s = new GitStore(root);
  await s.open();
  const g = await lantern();
  const r1 = await s.saveDraft(g, "one");

  // 1. Empty loose object: the crash test produced these. isomorphic-git never
  //    rewrites an object file that already exists, so saving the same content
  //    again "succeeds" but the revision cannot be read.
  const g2 = structuredClone(g);
  g2.entries[0].description += " (second save)";
  const text = `${JSON.stringify(g2, null, 2)}\n`;
  const { oid } = await git.hashBlob({ object: text });
  const objPath = join(s.dir, ".git", "objects", oid.slice(0, 2), oid.slice(2));
  fs.mkdirSync(join(objPath, ".."), { recursive: true });
  fs.writeFileSync(objPath, "");
  let r2;
  let saveResult;
  try {
    r2 = await s.saveDraft(g2, "two");
    saveResult = "save reported success";
  } catch (e) {
    saveResult = `save failed (${e.code ?? e.message})`;
  }
  row("git", "empty object file left by a crash, same content saved again", `${saveResult}; then ${r2 ? await tryRead(s, r2) : "n/a"}; verify reports ${(await verifyStore(s)).issues.length} issue(s)`);
  fs.rmSync(objPath);

  // 2. Torn branch file.
  const ref = join(s.dir, ".git", "refs", "heads", "main");
  const refText = fs.readFileSync(ref, "utf8");
  fs.writeFileSync(ref, "");
  let save3;
  try {
    await s.saveDraft(g, "three");
    save3 = "save went ahead";
  } catch (e) {
    save3 = "save refused";
  }
  // What isomorphic-git does on its own, without our guard.
  const unguarded = await git.log({ fs, dir: s.dir, ref: "main" }).then((l) => `${l.length} commits`, (e) => e.code);
  row("git", "empty branch file (refs/heads/main)", `git.log alone → ${unguarded}; with our guard: ${save3}. Without the guard the next commit starts a new, unrelated history (seen in the crash test).`);
  fs.writeFileSync(ref, refText);

  // 3. Empty index.
  fs.writeFileSync(join(s.dir, ".git", "index"), "");
  const opened = await new GitStore(root).open();
  row("git", "empty .git/index", `open() ${opened.rebuiltIndex ? "dropped and rebuilt it" : "did nothing"}; next save: ${await s.saveDraft(g, "four").then(() => "ok", (e) => e.code)}`);
  void r1;
}

console.table(rows);
