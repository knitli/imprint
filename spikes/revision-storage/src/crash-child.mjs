// SPDX-License-Identifier: AGPL-3.0-only
// Child for the crash test: save and freeze in a tight loop until killed.
import { GitStore } from "./git-store.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { lantern } from "./fixtures.mjs";

const [backend, root] = process.argv.slice(2);
const store = backend === "git" ? new GitStore(root) : new SnapshotStore(root);
await store.open();
let revs = await store.listRevisions();
let guide = revs.length ? await store.read(revs.at(-1).id) : await lantern();
process.stdout.write("ready\n");
for (let n = 0; ; n++) {
  const e = guide.entries[n % guide.entries.length];
  e.description = `${e.description.replace(/ \[save \d+\]$/, "")} [save ${n}]`;
  const id = await store.saveDraft(guide, `crash-test save ${n}`);
  if (n % 4 === 0) await store.freeze(id);
}
