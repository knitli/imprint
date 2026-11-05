# 0008: Store revisions as snapshot files; add Git later as an export

**Status:** Accepted (project owner, 2026-11-04)  
**Date:** 2026-11-04  
**Requirements:** M-01, R-GIT-01, R-GIT-02  
**Spike:** SP-02

## What we found

We built the same storage interface twice, on plain snapshot files and on `isomorphic-git` 1.44.3, and killed the saving process at random 60 times per run, across 6 runs.

| | Snapshot files | isomorphic-git |
| --- | --- | --- |
| Unreadable revisions or wrong digests | 0 in every run | 0 in four runs; store stuck in two |
| Branch pointer left empty after a crash | n/a | 1 to 5 times per run |
| Rounds where `git fsck` found damage | n/a | 35 to 59 |
| Time per save | 1.2 ms | 8.1 ms |
| Extra packages | 0 | about 55 |

Why: `isomorphic-git` writes its files in place, without writing to a temporary file first or flushing to disk. It also never rewrites an object file that already exists, so a damaged one stays damaged.

Example: a crash leaves the branch file empty. Without a guard, the next save quietly starts a new, unrelated history. In one run, only 64 of 180 commits were still reachable.

Native Git reads an undamaged repository fine, and the plain-language diff ("Entry gen-sponsor level changed from U to C") works on both backends.

## Proposed choice

- Store each revision as an immutable snapshot file, written to a temporary file, flushed, then renamed into place.
- Keep freeze records and the exact signed payload bytes outside any history tool. Verify against the freeze record, never against a branch or tag (R-GIT-02).
- Offer Git later as an export or sync format. Make it the main store only once a Git library passes the SP-02 crash test.

## What this means

- Deleted text still stays in earlier revisions, in either design. That is a handling question for each deployment, not something storage removes.
- **What would change this:** multi-author history becomes an MVP need, or a Git library passes the crash test. Report the unsafe writes upstream to `isomorphic-git`.
- **Still to test:** a real power cut (for example, a virtual machine hard reset). A killed process is gentler than losing power.
