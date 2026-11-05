// SPDX-License-Identifier: AGPL-3.0-only
//
// Crash-safe file writes (decision 0008, spike SP-02).
//
// replaceFile: write a temporary file in the same folder, flush it to disk,
// rename it over the target, then flush the folder. A crash leaves either the
// old file or the new one, never a half-written mix.
//
// createImmutable: the same, but the final step is a hard link that fails if
// the target already exists, so a frozen revision can never be overwritten.

import { randomBytes } from "node:crypto";
import { link, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const TEMP_PREFIX = ".tmp-";

async function writeTemp(target: string, data: Uint8Array | string): Promise<string> {
  const temp = join(dirname(target), `${TEMP_PREFIX}${basename(target)}.${randomBytes(6).toString("hex")}`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temp;
}

async function syncDir(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Atomically replace (or create) a file. */
export async function replaceFile(target: string, data: Uint8Array | string): Promise<void> {
  const temp = await writeTemp(target, data);
  try {
    await rename(temp, target);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
  await syncDir(dirname(target));
}

/** Atomically create a file that must not already exist. Throws EEXIST if it does. */
export async function createImmutable(target: string, data: Uint8Array | string): Promise<void> {
  const temp = await writeTemp(target, data);
  try {
    await link(temp, target);
  } finally {
    await unlink(temp).catch(() => {});
  }
  await syncDir(dirname(target));
}

/** Remove temporary files left behind by a crash. Readers never look at them. */
export async function removeStaleTemps(dir: string): Promise<number> {
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name.startsWith(TEMP_PREFIX)) {
      await unlink(join(dir, name)).catch(() => {});
      removed++;
    }
  }
  return removed;
}
