// SPDX-License-Identifier: AGPL-3.0-only
// Load the synthetic LANTERN guide that ships with @knitli/openscg.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseStrict } from "@knitli/openscg";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("@knitli/openscg/package.json"));

export async function lantern() {
  return parseStrict(await readFile(join(root, "examples/synthetic-lantern.json")));
}

export const SCRATCH =
  process.env.SP02_SCRATCH ?? "/tmp/claude-0/-home-user-imprint/0e1c32d1-cfff-5e67-ae56-45634b0a8f79/scratchpad/sp02";
