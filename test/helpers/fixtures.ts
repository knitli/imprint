// SPDX-License-Identifier: AGPL-3.0-only
// Test helpers. Every fixture is synthetic and ships with @knitli/openscg.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GuideService } from "../../src/core/service.ts";
import { GuideStore } from "../../src/core/store.ts";

export const OPENSCG = dirname(createRequire(import.meta.url).resolve("@knitli/openscg/package.json"));

export async function fixtureBytes(rel: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(OPENSCG, rel)));
}

export async function fixture(rel: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(OPENSCG, rel), "utf8"));
}

export const LANTERN = "examples/synthetic-lantern.json";
export const LANTERN_REVIEWED = "conformance/cases/valid-lantern-reviewed.json";
export const SIGNED = "conformance/vectors/attestation/valid.json";
export const SIGNED_ALTERED = "conformance/vectors/attestation/altered-payload.json";

export async function tempService(
  demo = false,
): Promise<{ service: GuideService; store: GuideStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "imprint-test-"));
  const store = new GuideStore(dir);
  await store.init();
  return {
    service: new GuideService(store, { demo }),
    store,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
