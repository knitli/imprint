# SP-02: How should we store revisions?

**Question:** should Imprint keep guide revision history in Git (through `isomorphic-git`), or in plain immutable snapshot files? This is requirement R-GIT-01.

**Short answer:** use **snapshot files** for the MVP. Our `isomorphic-git` setup lost history and left corrupt files after ordinary process crashes. The snapshot backend survived every crash we caused. Keep the data layout Git-friendly so we can add Git export or sync later (phase 3).

Synthetic data only. Everything here uses the LANTERN example that ships with `@knitli/openscg`.

## Versions

| Package | Version | Why this one |
| --- | --- | --- |
| `@knitli/openscg` | 0.1.0 (exact) | Decision 0002 |
| `isomorphic-git` | 1.44.3 (exact) | Newest release at least two weeks old (1.44.10 was out, released 2026-11-02) |
| Node.js | 22 | `.nvmrc` |
| Native Git (for the interop checks) | 2.43.0 | Ubuntu package |

## What we built

Both backends sit behind the same small interface: `saveDraft`, `freeze`, `listRevisions`, `read`, `diff`. Both write to the local disk through `node:fs`, not browser storage.

- **Snapshot backend** (`src/snapshot-store.mjs`). Every saved draft becomes a new file, `revisions/<number>-<hash>.json`, and is never changed afterwards. Each write goes to a temporary file, is flushed to disk (`fsync`), renamed into place, and then the folder is flushed too (`src/atomic.mjs`). Readers ignore temporary files, and opening the store deletes leftovers.
- **Git backend** (`src/git-store.mjs`). Every saved draft is a Git commit of `guide.json`, and the revision ID is the commit ID.
- **Freezing** works the same way in both. We store the canonical payload bytes and a separate freeze record holding the OpenSCG digest. In the Git backend that record lives *outside* Git history, as the addendum recommends. A tag `frozen/<id>` is added for convenience, but the record is what counts.
- **Diff** (`src/diff.mjs`) is shared by both backends. It compares two guides entry by entry and describes changes in words.

## How to run

```bash
npm ci
```

```bash
npm run all
```

`npm run all` runs three scripts:

- `npm run demo`: the diff, freeze binding, native Git and history checks.
- `npm run crash`: the crash test, 60 rounds per backend. Set `SP02_ITERATIONS` to change the number of rounds.
- `npm run torn`: deliberately damages files to see how each backend responds.

Test repositories go in the session scratchpad. Set `SP02_SCRATCH` to put them somewhere else, outside this repository.

## Results

### 1. Crash test: kill the process while it saves

A child process saves and freezes in a tight loop. We kill it with `SIGKILL` at a random moment, 60 times per backend. After each kill we reopen the store and check four things:

- every revision is listed and opens;
- it parses with OpenSCG's strict parser;
- every frozen revision still matches its digest;
- for Git only, `git fsck` reports no problems.

| | Snapshot | Git (`isomorphic-git`) |
| --- | --- | --- |
| Rounds | 60 | 60 |
| Revisions saved | ~1,100 | ~130 |
| Rounds that left a revision unreadable or a digest wrong | **0** | 0, but only after the two repairs below |
| Leftover temporary files cleaned up on open | ~30 (harmless) | n/a |
| Branch file `refs/heads/main` left empty | n/a | **2–3 per 60 rounds** |
| Index file `.git/index` left empty | n/a | 1–2 per 60 rounds |
| Rounds where `git fsck` reported damage | n/a | **55 of 60**: an empty object file appeared in round 5 and stayed |
| Time per save (50 saves, no crashes) | 1.2 ms | 8.1 ms |

Exact counts change from run to run because the kill times are random.

**What went wrong with Git, in plain words:**

- **The branch pointer got wiped.** `isomorphic-git` writes `refs/heads/main` directly, with no temporary file and no flush to disk. A kill at the wrong moment leaves the file empty. Without a guard, `isomorphic-git` then treats the branch as brand new, so the next save starts a **new, unrelated history**. Example from our first run: 180 commits existed, but only 64 could be reached from `main`, and there were 3 separate root commits. The older work was still on disk, but nothing pointed to it. We added a guard that refuses to save when the branch file is damaged. Fixing it still meant a person running native Git commands by hand.
- **Damaged files are never repaired.** `isomorphic-git` never rewrites an object file that already exists. The source comment (`index.cjs`, `writeObjectLoose`) says so: *"I don't know how we'd fix corrupted objects then."* So an empty object left by a crash stays broken. Saving identical content later reports success, but the revision can't be read (see the torn-write test).
- **The index got emptied.** An empty `.git/index` blocks every later save, in both `isomorphic-git` and native Git. It's only a cache, so we delete it and let it rebuild. That part is easy to fix.

A note on what this test shows: `SIGKILL` simulates a **program crash**, not a power cut. The operating system still writes out whatever it had buffered. A power cut would hit the Git backend harder, because it never flushes to disk at all. The snapshot backend flushes every file and folder.

### 2. Torn-write test: put damaged files in place on purpose

| Backend | Damage | What happened |
| --- | --- | --- |
| Snapshot | Half-written temporary file left behind | Readers ignore it, and opening the store removes it |
| Snapshot | A finished file cut short (a file-system fault) | Strict parsing rejects it (`OSCG-P002`) and the check reports it. It is never silently accepted |
| Git | Empty object file, then the same content saved again | **Save reports success, but reading fails** (`DecompressionError`) |
| Git | Empty `refs/heads/main` | `git.log` says "not found", the same answer as an empty repository. Our guard refuses to save |
| Git | Empty `.git/index` | Opening the store drops and rebuilds it, and the next save works |

### 3. Native Git can read the result

`git log`, `git show <commit>:guide.json` and `git fsck --full` all worked on an undamaged `isomorphic-git` repository. Interoperability itself is not the problem; crash safety is.

### 4. Diff that describes changes in words

Sample output, the same for both backends:

```text
Entry synthetic-new added (level U).
Entry perf-weakness removed (was level S).
Entry gen-sponsor level changed from U to C.
Entry gen-sponsor reason added.
Entry gen-sponsor declassification instruction added.
Entry perf-range reason changed.
Entry perf-range declassification instruction changed.
```

### 5. Freezing and approval binding

| Test | Result |
| --- | --- |
| Edit a frozen snapshot file in place | Detected: "content no longer matches frozen digest" |
| Move the Git tag `frozen/<id>` to a later, unapproved commit | Detected: the tag no longer matches the freeze record. The freeze record still points to the original commit and still verifies |
| Change the stored payload bytes | Detected: "stored payload bytes do not match frozen digest" |
| Rewrite history: point `main` at a new root with different content | Detected: the frozen commit is no longer on `main` |
| Then expire the reflog and run `git gc` | The frozen commit is **gone from the repository**. The payload copy kept outside Git still verifies |

The last row is the reason to keep frozen payloads and freeze records outside Git, whichever backend we choose. Anyone who can administer the repository can rewrite it.

### 6. What history keeps

Both backends keep deleted text. We put a marker string into one entry and then deleted that entry in the next revision.

- **Snapshot:** the marker is still in 1 earlier snapshot file. Removing it means deleting or redacting that one file, which breaks the parent link, so the gap is visible.
- **Git:** the marker is still found with `git log -S` in 2 commits. Removing it means rewriting history (`git filter-repo`) and then garbage collection, and doing the same in every clone and backup.

`isomorphic-git` writes no reflog. So if a commit is lost, Git's usual "undo" trail isn't there to recover it.

Either way, handling rules apply to the whole revision store and its backups, not just the latest version.

### 7. Size and complexity

| | Snapshot | Git |
| --- | --- | --- |
| Backend code | 98 lines + 31 shared atomic-write lines | 113 lines, including the crash guards we had to add |
| Shared diff and verify | 61 + 55 lines | same |
| Extra packages installed | 0 | about 55 (`isomorphic-git` and its dependencies; 67 total versus 12 for OpenSCG alone) |
| Install size of the library | none | about 5 MB |

## Recommendation

1. **MVP:** use the snapshot backend. It is smaller, about 7 times faster per save, has no extra dependencies, flushes everything to disk, and passed every crash we caused.
2. **Whatever the backend:** keep freeze records and canonical payload bytes outside any history tool, and always verify by the record, never by a branch or tag name.
3. **Later (phase 3, sharing and review):** add Git as an *export or sync* format. Write it with native Git, or with `isomorphic-git` only after fixing or wrapping its writes: temporary file, flush, rename, and no reuse of damaged objects. Don't make it the primary store until it passes this crash test.

## What would change this recommendation

- A first adopter needs shared, branch-based review in the first release. Git would then be worth its cost sooner, most likely native Git on a server rather than `isomorphic-git`.
- A newer `isomorphic-git` release writes refs, index and objects atomically and passes `npm run crash` with zero `fsck` problems. Re-run this spike when we upgrade it.
- The application has to run entirely in the browser with no local server. Then neither backend here applies as written; browser storage needs its own durability test.

## Follow-ups

- Report the non-atomic ref, index and object writes to `isomorphic-git` with a minimal reproduction. `npm run torn` is a starting point.
- Record the storage decision in `docs/decisions/` once the main session accepts it.
- Run a real power-loss test before calling any backend durable. A virtual machine with a hard reset will do.
