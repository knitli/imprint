// SPDX-License-Identifier: AGPL-3.0-only
//
// Exports (M-07). For a frozen revision, the PDF and workbook are generated
// once from the frozen bytes and then kept, so their hashes never change.
// The release manifest lists the JSON, the PDF, the workbook and every
// signature file (attestation) stored for the revision. Draft previews are
// generated fresh and labeled DRAFT / NOT APPROVED.

import { buildReleaseManifest, type ReleaseFile, type ReleaseManifest } from "@knitli/openscg";
import { bundle, fileName, fileStem, MEDIA, render } from "../export/release.ts";
import { type Doc, type GuideService, ServiceError } from "./service.ts";

export interface ExportFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export type RevisionExport = "json" | "pdf" | "xlsx" | "manifest" | "bundle";

const CACHE = { pdf: "guide.pdf", xlsx: "guide.xlsx" } as const;

export class ExportService {
  readonly guides: GuideService;
  constructor(guides: GuideService) {
    this.guides = guides;
  }

  /** A preview of the current draft. Never cached and always labeled as a draft. */
  async preview(key: string, kind: "pdf" | "xlsx"): Promise<ExportFile> {
    const view = await this.guides.get(key);
    const doc = view.doc;
    const bytes = await render(doc, kind, view.frozen ? "candidate" : "draft", new Date());
    return {
      name: `${fileStem(doc)}_${view.frozen ? "frozen" : "DRAFT"}.${MEDIA[kind].ext}`,
      type: MEDIA[kind].type,
      bytes,
    };
  }

  private async rendition(
    key: string,
    rev: { doc: Doc; record: { revision_id: string; frozen_at: string } },
    kind: "pdf" | "xlsx",
  ) {
    const existing = await this.guides.store.readExport(key, rev.record.revision_id, CACHE[kind]);
    if (existing) return existing;
    const bytes = await render(rev.doc, kind, "candidate", new Date(rev.record.frozen_at));
    return this.guides.store.writeExport(key, rev.record.revision_id, CACHE[kind], bytes);
  }

  /** Every released file of a revision, by file name, as listed in its manifest. */
  async releaseFiles(key: string, revisionId: string): Promise<Map<string, Uint8Array>> {
    const list = await this.releaseList(key, revisionId);
    return new Map(list.map((f) => [f.name, f.bytes]));
  }

  private async releaseList(key: string, revisionId: string): Promise<ReleaseFile[]> {
    const rev = await this.guides.revision(key, revisionId);
    const files: ReleaseFile[] = [
      { name: fileName(rev.doc, "json"), media_type: MEDIA.json.type, role: "guide-json", bytes: rev.bytes },
      {
        name: fileName(rev.doc, "pdf"),
        media_type: MEDIA.pdf.type,
        role: "rendition-pdf",
        bytes: await this.rendition(key, rev, "pdf"),
      },
      {
        name: fileName(rev.doc, "xlsx"),
        media_type: MEDIA.xlsx.type,
        role: "rendition-xlsx",
        bytes: await this.rendition(key, rev, "xlsx"),
      },
    ];
    for (const { id, json } of await this.guides.store.listSigned(key, revisionId, "attestations")) {
      files.push({
        name: `${fileStem(rev.doc)}_attestation-${id}.json`,
        media_type: "application/json",
        role: "attestation",
        bytes: new TextEncoder().encode(json),
      });
    }
    return files;
  }

  async manifest(key: string, revisionId: string): Promise<ReleaseManifest> {
    const rev = await this.guides.revision(key, revisionId);
    return buildReleaseManifest(rev.doc as never, await this.releaseList(key, revisionId));
  }

  async revisionFile(key: string, revisionId: string, kind: RevisionExport): Promise<ExportFile> {
    const rev = await this.guides.revision(key, revisionId);
    const doc: Doc = rev.doc;
    const stem = fileStem(doc);
    switch (kind) {
      case "json":
        return { name: fileName(doc, "json"), type: MEDIA.json.type, bytes: rev.bytes };
      case "pdf":
      case "xlsx":
        return {
          name: fileName(doc, kind),
          type: MEDIA[kind].type,
          bytes: await this.rendition(key, rev, kind),
        };
      case "manifest": {
        const manifest = await this.manifest(key, revisionId);
        return {
          name: `${stem}_release-manifest.json`,
          type: "application/json",
          bytes: new TextEncoder().encode(`${JSON.stringify({ manifest }, null, 2)}\n`),
        };
      }
      case "bundle": {
        const files = await this.releaseList(key, revisionId);
        const manifest = await this.manifest(key, revisionId);
        const signed = await this.guides.store.listSigned(key, revisionId, "manifest-signatures");
        const extra = new Map<string, Uint8Array>(
          signed.map(({ id, json }) => [
            `release-manifest.signed-${id}.json`,
            new TextEncoder().encode(json),
          ]),
        );
        const bytes = await bundle(
          doc,
          files.map((f) => ({ name: f.name, bytes: f.bytes })),
          new TextEncoder().encode(`${JSON.stringify({ manifest }, null, 2)}\n`),
          extra,
          new Date(rev.record.frozen_at),
        );
        return { name: `${stem}_release.zip`, type: "application/zip", bytes };
      }
      default:
        throw new ServiceError("not_found", "No such export.");
    }
  }
}
