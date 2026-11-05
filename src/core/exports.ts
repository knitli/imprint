// SPDX-License-Identifier: AGPL-3.0-only
//
// Exports (M-07). For a frozen revision, each file is generated once from the
// frozen bytes and then kept, so the release manifest's hashes always match
// what people download. Draft previews are generated fresh and labeled
// DRAFT / NOT APPROVED.

import { canonicalize, parseStrict } from "@knitli/openscg";
import { bundle, type ExportKind, fileName, MEDIA, manifestFor, render } from "../export/release.ts";
import { type Doc, type GuideService, ServiceError } from "./service.ts";

export interface ExportFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

export type RevisionExport = "json" | "pdf" | "xlsx" | "manifest" | "bundle";

const CACHE: Record<"pdf" | "xlsx" | "manifest" | "bundle", string> = {
  pdf: "guide.pdf",
  xlsx: "guide.xlsx",
  manifest: "release-manifest.json",
  bundle: "release.zip",
};

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
    const stem = fileName(doc, kind).replace(/\.(pdf|xlsx)$/, "");
    return {
      name: `${stem}_${view.frozen ? "frozen" : "DRAFT"}.${MEDIA[kind].ext}`,
      type: MEDIA[kind].type,
      bytes,
    };
  }

  private async cached(
    key: string,
    rev: string,
    kind: "pdf" | "xlsx" | "manifest" | "bundle",
    make: () => Promise<Uint8Array>,
  ): Promise<Uint8Array> {
    const existing = await this.guides.store.readExport(key, rev, CACHE[kind]);
    if (existing) return existing;
    return this.guides.store.writeExport(key, rev, CACHE[kind], await make());
  }

  async revisionFile(key: string, revisionId: string, kind: RevisionExport): Promise<ExportFile> {
    const rev = await this.guides.revision(key, revisionId);
    const doc: Doc = rev.doc;
    const created = new Date(rev.record.frozen_at);
    const files = async (): Promise<Map<ExportKind, Uint8Array>> =>
      new Map<ExportKind, Uint8Array>([
        ["json", rev.bytes],
        ["pdf", await this.cached(key, revisionId, "pdf", () => render(doc, "pdf", "candidate", created))],
        ["xlsx", await this.cached(key, revisionId, "xlsx", () => render(doc, "xlsx", "candidate", created))],
      ]);
    const manifest = () =>
      this.cached(key, revisionId, "manifest", async () => {
        const m = await manifestFor(doc, await files());
        return new TextEncoder().encode(`${JSON.stringify({ manifest: m }, null, 2)}\n`);
      });

    switch (kind) {
      case "json":
        return { name: fileName(doc, "json"), type: MEDIA.json.type, bytes: rev.bytes };
      case "pdf":
      case "xlsx": {
        const all = await files();
        return { name: fileName(doc, kind), type: MEDIA[kind].type, bytes: all.get(kind) as Uint8Array };
      }
      case "manifest":
        return {
          name: `${fileName(doc, "json").replace(/\.json$/, "")}_release-manifest.json`,
          type: "application/json",
          bytes: await manifest(),
        };
      case "bundle": {
        const bytes = await this.cached(key, revisionId, "bundle", async () =>
          bundle(doc, await files(), await manifest(), created),
        );
        return {
          name: `${fileName(doc, "json").replace(/\.json$/, "")}_release.zip`,
          type: "application/zip",
          bytes,
        };
      }
      default:
        throw new ServiceError("not_found", "No such export.");
    }
  }
}

/** Check that a frozen revision's stored bytes are still canonical (used by tests and audits). */
export function isCanonical(bytes: Uint8Array): boolean {
  const again = canonicalize(parseStrict(bytes));
  return again.length === bytes.length && again.every((b, i) => b === bytes[i]);
}
