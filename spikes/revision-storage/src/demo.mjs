// SPDX-License-Identifier: AGPL-3.0-only
// SP-02 demo: guide-aware diff, freeze/approval binding, native Git interop,
// and what history keeps. Synthetic data only.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";
import git from "isomorphic-git";
import { GitStore } from "./git-store.mjs";
const AUTHOR = { name: "Synthetic Author", email: "author@example.invalid" };
import { SnapshotStore } from "./snapshot-store.mjs";
import { lantern, SCRATCH } from "./fixtures.mjs";
import { verifyStore } from "./verify.mjs";

const MARKER = "SYNTHETIC-DELETED-TEXT-MARKER";
const clone = (v) => structuredClone(v);
const h = (t) => console.log(`\n=== ${t} ===`);

function edits(g0) {
  const g = clone(g0);
  g.revision_id = "2026-r2";
  const byId = (id) => g.entries.find((e) => e.entry_id === id);
  byId("gen-sponsor").level = "C";
  byId("gen-sponsor").reason = { categories: ["1.4(c)"], explanation: "Synthetic rationale." };
  byId("gen-sponsor").declassification = { kind: "date", date: "2050-01-01" };
  byId("perf-range").reason.explanation = "Synthetic rationale, reworded.";
  byId("perf-range").declassification = { kind: "relative_to_record_creation", years: 10 };
  g.entries = g.entries.filter((e) => e.entry_id !== "perf-weakness");
  g.entries.push({ entry_id: "synthetic-new", kind: "element", section_id: "general", description: "A new synthetic element.", level: "U" });
  return g;
}

async function run(name, store) {
  h(`${name}: guide-aware diff`);
  await store.open();
  const g1 = await lantern();
  g1.entries.find((e) => e.entry_id === "perf-weakness").description += ` ${MARKER}`;
  const r1 = await store.saveDraft(g1, "Start from synthetic LANTERN");
  const rec = await store.freeze(r1);
  const r2 = await store.saveDraft(edits(g1), "Second synthetic draft");
  for (const line of await store.diff(r1, r2)) console.log(`  ${line}`);

  h(`${name}: freeze binding`);
  console.log(`  frozen ${r1.slice(0, 18)} digest ${rec.payload_digest.value.slice(0, 16)}…`);
  console.log(`  verify untouched store:`, (await verifyStore(store)).issues.length === 0 ? "ok" : "FAIL");
  return { r1, r2, rec };
}

async function main() {
  rmSync(SCRATCH, { recursive: true, force: true });
  const results = {};

  // ---------- snapshot backend ----------
  const snap = new SnapshotStore(join(SCRATCH, "demo-snapshot"));
  const s = await run("snapshot", snap);
  // Tamper: rewrite the frozen revision file in place (an attacker or a bug).
  const p = join(snap.revDir, `${s.r1}.json`);
  const orig = readFileSync(p, "utf8");
  writeFileSync(p, orig.replace('"level":"S"', '"level":"C"'));
  console.log("  after editing the frozen revision file:", (await verifyStore(snap)).issues);
  writeFileSync(p, orig);
  h("snapshot: what history keeps");
  const snapHits = readdirSync(snap.revDir).filter((n) => readFileSync(join(snap.revDir, n), "utf8").includes(MARKER));
  console.log(`  text deleted in r2 still present in ${snapHits.length} snapshot file(s): ${snapHits.join(", ")}`);
  results.snapshot = { deletedTextFiles: snapHits.length };

  // ---------- git backend ----------
  const gs = new GitStore(join(SCRATCH, "demo-git"));
  const g = await run("git", gs);
  const tag = `frozen/${g.r1.slice(0, 12)}`;
  // Move the tag to the later, unapproved commit.
  execFileSync("git", ["-C", gs.dir, "tag", "-f", tag, g.r2], { stdio: "pipe" });
  const tagNow = await gs.resolveTag(tag);
  const recNow = await gs.freezeRecord(g.r1);
  console.log(`  tag ${tag} moved to ${tagNow.slice(0, 12)}; freeze record still names ${recNow.revision.slice(0, 12)}`);
  console.log(`  check "tag matches record": ${tagNow === recNow.revision ? "match" : "MISMATCH detected"}`);
  console.log(`  verify by record (not by tag):`, (await verifyStore(gs)).issues.length === 0 ? "ok" : "FAIL");
  // Tamper: corrupt the stored payload bytes for the frozen revision.
  const pp = join(gs.frozenDir, `${g.r1}.payload.jcs`);
  const payload = readFileSync(pp);
  writeFileSync(pp, Buffer.concat([payload.subarray(0, payload.length - 2), Buffer.from(" }")]));
  console.log("  after altering stored payload bytes:", (await verifyStore(gs)).issues);
  writeFileSync(pp, payload);
  h("git: native Git interoperability");
  const sh = (...a) => execFileSync("git", ["-C", gs.dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  console.log(sh("log", "--oneline", "--all", "--decorate").split("\n").map((l) => `  ${l}`).join("\n"));
  console.log(`  git show ${g.r1.slice(0, 12)}:guide.json | head -c 80 → ${sh("show", `${g.r1}:guide.json`).slice(0, 80).replace(/\n/g, " ")}`);
  console.log(`  git fsck --full → ${sh("fsck", "--full") || "(no problems reported)"}`);

  h("git: what history keeps");
  const found = sh("log", "--all", "--oneline", "-S", MARKER);
  console.log(`  commits whose diff adds or removes the deleted text:\n${found.split("\n").map((l) => `    ${l}`).join("\n")}`);
  const reflog = sh("reflog");
  console.log(`  native reflog entries (also keep "lost" commits reachable): ${reflog ? reflog.split("\n").length : 0}`);
  results.git = { deletedTextCommits: found.split("\n").length };
  h("git: rewritten history");
  // Rewrite history: replace the frozen root commit with a new root whose
  // content differs, and force main to it (what a repository administrator could do).
  const g2 = await gs.read(g.r1);
  g2.entries[2].level = "C";
  writeFileSync(join(gs.dir, "guide.json"), `${JSON.stringify(g2, null, 2)}\n`);
  await git.add({ fs, dir: gs.dir, filepath: "guide.json" });
  const newRoot = await git.commit({ fs, dir: gs.dir, message: "Rewritten history (synthetic attack)", author: AUTHOR, committer: AUTHOR, parent: [], noUpdateBranch: true });
  await git.writeRef({ fs, dir: gs.dir, ref: "refs/heads/main", value: newRoot, force: true });
  const onMain = (await git.log({ fs, dir: gs.dir, ref: "main" })).some((c) => c.oid === g.r1);
  console.log(`  main rewritten to new root ${newRoot.slice(0, 12)}; frozen ${g.r1.slice(0, 12)} still on main? ${onMain ? "yes" : "no → detected"}`);
  console.log(`  frozen object still readable before gc? ${(await gs.read(g.r1)) ? "yes" : "no"}`);
  execFileSync("git", ["-C", gs.dir, "tag", "-d", tag], { stdio: "pipe" });
  execFileSync("git", ["-C", gs.dir, "reflog", "expire", "--expire=now", "--all"], { stdio: "pipe" });
  execFileSync("git", ["-C", gs.dir, "gc", "-q", "--prune=now"], { stdio: "pipe" });
  let readable = true;
  try {
    await gs.read(g.r1);
  } catch {
    readable = false;
  }
  const { sha256 } = await import("@knitli/openscg");
  const outside = (await sha256(await gs.frozenPayload(g.r1))).value === recNow.payload_digest.value;
  console.log(`  after native gc: frozen commit readable from repo? ${readable ? "yes" : "no"}; payload kept outside Git still verifies? ${outside ? "yes" : "no"}`);

}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
