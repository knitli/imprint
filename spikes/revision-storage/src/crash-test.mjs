// SPDX-License-Identifier: AGPL-3.0-only
// SP-02 crash test: kill a saving process at random moments and check that
// every revision still opens, parses strictly, and frozen digests still match.
// SIGKILL simulates a process crash. It does NOT simulate power loss: the
// operating system still writes out what it had buffered. See torn-write-test.mjs.

import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { GitStore } from "./git-store.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { SCRATCH } from "./fixtures.mjs";
import { verifyStore } from "./verify.mjs";

const ITERATIONS = Number(process.env.SP02_ITERATIONS ?? 60);
const child = new URL("./crash-child.mjs", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(backend, root) {
  const p = spawn(process.execPath, [child, backend, root], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  const exited = new Promise((r) => p.once("exit", r));
  const ready = await Promise.race([
    new Promise((r) => p.stdout.once("data", () => r(true))),
    exited.then(() => false),
  ]);
  if (!ready) throw new Error(`child could not start: ${err.split("\n").find((l) => l.includes("Error")) ?? err}`);
  const early = await Promise.race([sleep(5 + Math.floor(Math.random() * 120)).then(() => false), exited.then(() => true)]);
  if (early) throw new Error(`child failed while saving: ${err.split("\n").find((l) => l.includes("rror")) ?? err}`);
  p.kill("SIGKILL");
  await exited;
}

// What an operator would do by hand: point main at the newest commit object.
function repairBranch(repo) {
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"], { encoding: "utf8" });
  const commits = out.split("\n").filter((l) => l.endsWith(" commit")).map((l) => l.split(" ")[0]);
  let best;
  let bestTime = -1;
  for (const c of commits) {
    const t = Number(execFileSync("git", ["-C", repo, "show", "-s", "--format=%ct", c], { encoding: "utf8" }).trim());
    if (t > bestTime) [best, bestTime] = [c, t];
  }
  rmSync(join(repo, ".git", "refs", "heads", "main"));
  execFileSync("git", ["-C", repo, "update-ref", "refs/heads/main", best]);
}

async function test(backend) {
  const root = join(SCRATCH, `crash-${backend}`);
  rmSync(root, { recursive: true, force: true });
  const make = () => (backend === "git" ? new GitStore(root) : new SnapshotStore(root));
  let failures = 0;
  let tempFilesRemoved = 0;
  let indexRebuilds = 0;
  let branchRepairs = 0;
  let fsckProblems = 0;
  const examples = [];
  const t0 = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    try {
      await once(backend, root);
    } catch (e) {
      failures++;
      examples.push(`iteration ${i}: ${e.message.slice(0, 200)}`);
      continue;
    }
    const store = make();
    if (backend === "git" && store.branchRefCorrupt()) {
      branchRepairs++;
      if (examples.length < 6) examples.push(`iteration ${i}: refs/heads/main torn by the crash; repaired by hand from the newest commit`);
      repairBranch(join(root, "repo"));
    }
    const opened = await store.open();
    tempFilesRemoved += opened.removedTempFiles ?? 0;
    if (opened.rebuiltIndex) indexRebuilds++;
    const v = await verifyStore(store);
    if (v.issues.length) {
      failures++;
      if (examples.length < 5) examples.push(`iteration ${i}: ${v.issues.join("; ")}`);
    }
    if (backend === "git") {
      try {
        execFileSync("git", ["-C", join(root, "repo"), "fsck", "--full", "--no-dangling"], { stdio: "pipe" });
      } catch (e) {
        fsckProblems++;
        if (examples.length < 5) examples.push(`iteration ${i}: git fsck: ${String(e.stderr).trim().slice(0, 200)}`);
      }
    }
  }
  const final = await verifyStore(make());
  return {
    backend,
    iterations: ITERATIONS,
    revisions: final.revisions,
    frozenNotOnBranch: final.frozenNotOnBranch,
    finalIssues: final.issues.length,
    frozen: final.frozen,
    iterationsWithProblems: failures,
    gitFsckProblems: backend === "git" ? fsckProblems : "n/a",
    gitBranchRefTornAndRepaired: backend === "git" ? branchRepairs : "n/a",
    gitIndexRebuiltAfterCrash: backend === "git" ? indexRebuilds : "n/a",
    leftoverTempFilesCleaned: backend === "git" ? "n/a" : tempFilesRemoved,
    seconds: Math.round((Date.now() - t0) / 1000),
    examples,
  };
}

for (const b of ["snapshot", "git"]) console.log(JSON.stringify(await test(b), null, 2));
