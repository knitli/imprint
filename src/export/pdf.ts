// SPDX-License-Identifier: AGPL-3.0-only
//
// Render the PDF with the Typst command-line tool (decision 0005).
//
// Typst is a separate, pinned binary (0.15.0), installed with
// scripts/install-typst.sh or provided by the deployment. It runs with
// no network access needed: --ignore-system-fonts makes it use only the fonts
// built into Typst, so the same input gives the same bytes on any machine.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { GuideModel } from "./model.ts";

const run = promisify(execFile);
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "guide.typ");
export const TYPST_VERSION = "0.15.0";

export class PdfUnavailable extends Error {}

const LOCAL_TYPST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tools", "typst", "typst");

/** IMPRINT_TYPST, then the copy installed by scripts/install-typst.sh, then `typst` on the PATH. */
export function typstCommand(): string {
  if (process.env.IMPRINT_TYPST) return process.env.IMPRINT_TYPST;
  return existsSync(LOCAL_TYPST) ? LOCAL_TYPST : "typst";
}

/** Check that the configured Typst is the pinned version. */
export async function typstVersion(): Promise<string | null> {
  try {
    const { stdout } = await run(typstCommand(), ["--version"], { timeout: 10_000 });
    return /typst (\S+)/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Render a PDF. `created` is written into the PDF as its creation date; pass
 * the freeze time so a frozen revision always renders to the same bytes.
 */
export async function renderPdf(model: GuideModel, created: Date): Promise<Uint8Array> {
  const version = await typstVersion();
  if (version !== TYPST_VERSION) {
    throw new PdfUnavailable(
      version
        ? `PDF export needs Typst ${TYPST_VERSION}, but found ${version}.`
        : `PDF export needs Typst ${TYPST_VERSION}. Install it, or set IMPRINT_TYPST to its path.`,
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "imprint-pdf-"));
  try {
    await copyFile(TEMPLATE, join(dir, "guide.typ"));
    await writeFile(join(dir, "model.json"), JSON.stringify(model), { mode: 0o600 });
    await run(
      typstCommand(),
      [
        "compile",
        "--root",
        dir,
        "--input",
        "model=model.json",
        "--pdf-standard",
        "ua-1",
        "--ignore-system-fonts",
        "--creation-timestamp",
        String(Math.floor(created.getTime() / 1000)),
        join(dir, "guide.typ"),
        join(dir, "guide.pdf"),
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ).catch((e: { stderr?: string }) => {
      // Typst's message names the template line, never guide text it rendered.
      throw new Error(`Typst could not render this guide. ${(e.stderr ?? "").split("\n")[0] ?? ""}`.trim());
    });
    return new Uint8Array(await readFile(join(dir, "guide.pdf")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
