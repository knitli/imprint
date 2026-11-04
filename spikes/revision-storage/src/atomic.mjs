// SPDX-License-Identifier: AGPL-3.0-only
// Write a file so that a crash leaves either the old state or the new file,
// never a half-written file under the final name: temp file, fsync, rename,
// fsync the directory.

import { open, rename } from "node:fs/promises";
import { join } from "node:path";

export const isTemp = (name) => name.endsWith(".tmp");

export async function fsyncDir(dir) {
  const fh = await open(dir, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export async function atomicWriteFile(dir, name, bytes) {
  const tmp = join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  const fh = await open(tmp, "wx");
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, join(dir, name));
  await fsyncDir(dir);
}
