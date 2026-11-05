// SPDX-License-Identifier: AGPL-3.0-only
//
// Exports of one guide revision (M-07): the OpenSCG JSON, a PDF and a
// workbook generated from the same frozen revision, plus a release manifest
// listing the SHA-256 of each file (OpenSCG spec section 10.3).
//
// A shared payload digest on every rendition identifies the revision, but it
// does not prove a PDF or workbook matches the JSON. The manifest does that
// for the exact bytes released, once it is signed (signing is a later step).

import type { ReleaseFile } from "@knitli/openscg";
import JSZip from "jszip";
import type { Doc } from "../core/service.ts";
import { buildModel, type RenditionStatus } from "./model.ts";
import { renderPdf } from "./pdf.ts";
import { writeWorkbook } from "./xlsx.ts";

export type ExportKind = "json" | "pdf" | "xlsx";

export const MEDIA: Record<ExportKind, { type: string; ext: string; role: ReleaseFile["role"] }> = {
  json: { type: "application/json", ext: "json", role: "guide-json" },
  pdf: { type: "application/pdf", ext: "pdf", role: "rendition-pdf" },
  xlsx: {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
    role: "rendition-xlsx",
  },
};

/** A safe file name stem for a revision, for example "lantern-guide_2026-r1". */
export function fileStem(guide: Doc): string {
  const rev = typeof guide.revision_id === "string" ? guide.revision_id : "draft";
  const title = typeof guide.title === "string" ? guide.title : "guide";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "guide"}_${rev}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

export const fileName = (guide: Doc, kind: ExportKind): string => `${fileStem(guide)}.${MEDIA[kind].ext}`;

/** Render one human-readable rendition. `created` fixes timestamps so output is repeatable. */
export async function render(
  guide: Doc,
  kind: "pdf" | "xlsx",
  status: RenditionStatus,
  created: Date,
): Promise<Uint8Array> {
  const model = await buildModel(guide, status);
  if (kind === "pdf") return renderPdf(model, created);
  return writeWorkbook(guide, { statusLabel: model.statusLabel, fixedTime: created });
}

/** One zip with every file and the manifest. Fixed timestamps make it repeatable. */
export async function bundle(
  guide: Doc,
  files: readonly { name: string; bytes: Uint8Array }[],
  manifestBytes: Uint8Array,
  extra: ReadonlyMap<string, Uint8Array>,
  created: Date,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const opts = { date: created, createFolders: false };
  for (const f of files) zip.file(f.name, f.bytes, opts);
  zip.file("release-manifest.json", manifestBytes, opts);
  for (const [name, bytes] of extra) zip.file(name, bytes, opts);
  zip.file(
    "README.txt",
    [
      "This release was exported by Imprint.",
      "",
      `Guide ID: ${String(guide.guide_id)}`,
      `Revision: ${String(guide.revision_id)}`,
      "",
      "The OpenSCG JSON file is the authoritative copy. The PDF and workbook are",
      "renditions of the same frozen revision. Files named *_attestation-*.json",
      "are detached signatures over the revision's approval statement.",
      "release-manifest.json lists the SHA-256 hash of each file; compare them to",
      "check that nothing changed. An unsigned manifest is not proof of origin;",
      "release-manifest.signed-*.json files, if present, are signed copies.",
      "A valid signature does not show that the signer had classification",
      "authority; that is a separate human review.",
      guide.synthetic === true ? "\nTHIS GUIDE IS SYNTHETIC: it is not real classification guidance." : "",
      "",
    ].join("\n"),
    opts,
  );
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
}
