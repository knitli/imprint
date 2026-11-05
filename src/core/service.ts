// SPDX-License-Identifier: AGPL-3.0-only
//
// The guide service: everything Imprint does to a guide, independent of the
// web interface. All format behaviour comes from @knitli/openscg (decision 0002,
// 0003); this file only decides when to call it and what to store.

import { randomUUID } from "node:crypto";
import {
  canonicalize,
  compareForLoss,
  type Finding,
  isApprovalReady,
  type LossReport,
  PAYLOAD_EXCLUDED_MEMBERS,
  parseStrict,
  payloadDigest,
  SPEC_VERSION,
  StrictParseError,
  validate,
  verifyAttestation,
} from "@knitli/openscg";
import { type FreezeRecord, type GuideStore, isLocalId, keyFor, StoreError } from "./store.ts";

/** A guide as stored. Drafts may be incomplete, so nothing is assumed about shape. */
export type Doc = Record<string, unknown>;

export const LEVELS = ["U", "C", "S", "TS"] as const;
export type Level = (typeof LEVELS)[number];
export const PROFILES = ["cnsi-core", "dod-5200.45"] as const;

/** Largest guide file we accept, in bytes. OpenSCG's own limit is 16 MiB. */
export const MAX_GUIDE_BYTES = 8 * 1024 * 1024;

export class ServiceError extends Error {
  readonly code: "bad_input" | "not_found" | "conflict" | "not_ready" | "rejected";
  readonly findings: readonly Finding[];
  constructor(code: ServiceError["code"], message: string, findings: readonly Finding[] = []) {
    super(message);
    this.code = code;
    this.findings = findings;
  }
}

export interface ServiceOptions {
  /** Demo mode accepts only guides marked synthetic (M-13). */
  readonly demo: boolean;
}

export interface GuideView {
  readonly key: string;
  readonly doc: Doc;
  readonly findings: readonly Finding[];
  readonly approvalReady: boolean;
  /** True when the draft's revision_id has already been frozen: it can no longer be edited. */
  readonly frozen: boolean;
  readonly revisions: readonly FreezeRecord[];
}

export interface GuideSummary {
  readonly key: string;
  readonly guideId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly state: string;
  readonly synthetic: boolean;
  readonly frozen: boolean;
}

export interface ImportResult {
  readonly key: string;
  readonly findings: readonly Finding[];
  readonly loss: LossReport;
  readonly importedAsFrozen: boolean;
}

const serialize = (doc: Doc): string => `${JSON.stringify(doc, null, 2)}\n`;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});

function withoutExcluded(doc: Doc): Doc {
  const out: Doc = { ...doc };
  for (const m of PAYLOAD_EXCLUDED_MEMBERS) delete out[m];
  return out;
}

export class GuideService {
  readonly store: GuideStore;
  readonly options: ServiceOptions;

  constructor(store: GuideStore, options: ServiceOptions) {
    this.store = store;
    this.options = options;
  }

  findings(doc: Doc): Finding[] {
    return validate(doc);
  }

  async list(): Promise<GuideSummary[]> {
    const out: GuideSummary[] = [];
    for (const key of await this.store.keys()) {
      const doc = await this.readDraft(key).catch(() => null);
      if (!doc) continue;
      out.push({
        key,
        guideId: str(doc.guide_id),
        title: str(doc.title) || "(untitled)",
        revisionId: str(doc.revision_id),
        state: str(obj(doc.lifecycle).state),
        synthetic: doc.synthetic === true,
        frozen: await this.store.isFrozen(key, str(doc.revision_id)),
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  private async readDraft(key: string): Promise<Doc> {
    const parsed = parseStrict(await this.store.readDraft(key), { maxBytes: MAX_GUIDE_BYTES });
    return obj(parsed);
  }

  async get(key: string): Promise<GuideView> {
    const doc = await this.readDraft(key).catch((e) => {
      if (e instanceof StoreError && e.code !== "exists") throw new ServiceError("not_found", e.message);
      throw e;
    });
    const findings = this.findings(doc);
    const revisions = await this.store.listRevisions(key);
    const frozen = await this.store.isFrozen(key, str(doc.revision_id));
    return { key, doc, findings, approvalReady: isApprovalReady(findings), frozen, revisions };
  }

  /** Start a new, empty guide. The person chooses the document's own classification (spec 4.3). */
  async create(input: {
    title: string;
    classification: Level;
    profile: string;
    synthetic: boolean;
  }): Promise<string> {
    const title = input.title.trim();
    if (!title) throw new ServiceError("bad_input", "Give the guide a title.");
    if (!LEVELS.includes(input.classification))
      throw new ServiceError("bad_input", "Choose a classification.");
    if (!(PROFILES as readonly string[]).includes(input.profile))
      throw new ServiceError("bad_input", "Choose a profile.");
    if (this.options.demo && !input.synthetic) {
      throw new ServiceError("rejected", "This is a demo. Every guide must be marked synthetic.");
    }
    const doc: Doc = {
      schema_version: SPEC_VERSION,
      profile: input.profile,
      ...(input.synthetic ? { synthetic: true } : {}),
      guide_id: `urn:uuid:${randomUUID()}`,
      revision_id: "r1",
      title,
      lifecycle: { state: "draft" },
      document_markings: { classification: input.classification, review: { status: "not_started" } },
      entries: [],
    };
    return this.store.create(doc.guide_id as string, serialize(doc));
  }

  /**
   * Save a draft. A draft may contain errors (requirements §3 step 3), but a
   * frozen revision can never be edited: start a new revision instead.
   */
  async saveDraft(key: string, doc: Doc): Promise<GuideView> {
    const current = await this.get(key);
    if (current.frozen) {
      throw new ServiceError(
        "conflict",
        `Revision ${str(current.doc.revision_id)} is frozen. Start a new revision to make changes.`,
      );
    }
    if (doc.guide_id !== current.doc.guide_id)
      throw new ServiceError("bad_input", "The guide ID cannot change.");
    if (this.options.demo && doc.synthetic !== true) {
      throw new ServiceError("rejected", "This is a demo. Every guide must be marked synthetic.");
    }
    if (await this.store.isFrozen(key, str(doc.revision_id))) {
      throw new ServiceError(
        "conflict",
        `Revision ${str(doc.revision_id)} is already frozen. Choose another revision ID.`,
      );
    }
    const next: Doc = { ...doc, lifecycle: { ...obj(doc.lifecycle), state: "draft" } };
    const bytes = serialize(next);
    if (Buffer.byteLength(bytes) > MAX_GUIDE_BYTES)
      throw new ServiceError("bad_input", "The guide is too large.");
    await this.store.writeDraft(key, bytes);
    return this.get(key);
  }

  /**
   * Freeze the current draft as a candidate revision (requirements §3 step 5).
   * Only an approval-ready draft can be frozen. The frozen bytes never change.
   */
  async freeze(key: string): Promise<FreezeRecord> {
    const view = await this.get(key);
    if (view.frozen) throw new ServiceError("conflict", "This revision is already frozen.");
    const revisionId = str(view.doc.revision_id);
    if (!isLocalId(revisionId)) throw new ServiceError("bad_input", "The revision ID is not valid.");
    const candidate = withoutExcluded({
      ...view.doc,
      lifecycle: { ...obj(view.doc.lifecycle), state: "candidate" },
    });
    const findings = this.findings(candidate);
    if (!isApprovalReady(findings)) {
      throw new ServiceError("not_ready", "Resolve the items below before freezing.", findings);
    }
    const record: FreezeRecord = {
      revision_id: revisionId,
      payload_digest: await payloadDigest(candidate as never),
      frozen_at: new Date().toISOString(),
      openscg_spec: SPEC_VERSION,
    };
    await this.store.freeze(key, record, canonicalize(candidate));
    await this.store.writeDraft(key, serialize(candidate));
    return record;
  }

  /** Begin a new draft revision from the frozen one. Earlier revisions stay as they were. */
  async newRevision(key: string, revisionId: string): Promise<GuideView> {
    const view = await this.get(key);
    if (!view.frozen)
      throw new ServiceError("conflict", "The current revision is still a draft. Edit it directly.");
    if (!isLocalId(revisionId)) {
      throw new ServiceError(
        "bad_input",
        "A revision ID uses letters, numbers, dots, hyphens or underscores, starts with a letter or number, and is at most 64 characters.",
      );
    }
    if (await this.store.isFrozen(key, revisionId)) {
      throw new ServiceError(
        "conflict",
        `Revision ${revisionId} already exists. Choose another revision ID.`,
      );
    }
    const old = view.doc;
    const prior = view.revisions.find((r) => r.revision_id === old.revision_id);
    const history = obj(old.history);
    const previous = Array.isArray(history.previous_revisions) ? history.previous_revisions : [];
    const markings = obj(old.document_markings);
    const next: Doc = {
      ...old,
      revision_id: revisionId,
      lifecycle: { ...obj(old.lifecycle), state: "draft" },
      history: {
        ...history,
        previous_revisions: [
          ...previous,
          { revision_id: old.revision_id, ...(prior ? { payload_digest: prior.payload_digest } : {}) },
        ],
      },
      // New content needs a fresh look at the document's own markings.
      document_markings: { ...markings, review: { status: "pending" } },
    };
    await this.store.writeDraft(key, serialize(next));
    return this.get(key);
  }

  /**
   * Import an OpenSCG file (M-08). Parsing is strict. A file that carries
   * attestations is imported as a frozen revision, and only if every
   * attestation still matches its content: a modified signed payload is refused.
   */
  async importGuide(bytes: Uint8Array): Promise<ImportResult> {
    if (bytes.byteLength > MAX_GUIDE_BYTES) throw new ServiceError("bad_input", "The file is too large.");
    let parsed: unknown;
    try {
      parsed = parseStrict(bytes, { maxBytes: MAX_GUIDE_BYTES });
    } catch (e) {
      if (e instanceof StrictParseError) {
        throw new ServiceError("bad_input", `This file cannot be read safely (${e.code}). ${e.message}`);
      }
      throw e;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ServiceError("bad_input", "This file is not an OpenSCG guide.");
    }
    const doc = parsed as Doc;
    if (typeof doc.guide_id !== "string" || !doc.guide_id) {
      throw new ServiceError("bad_input", "This file has no guide_id, so it cannot be stored.");
    }
    if (!isLocalId(doc.revision_id))
      throw new ServiceError("bad_input", "This file has no valid revision_id.");
    if (this.options.demo && doc.synthetic !== true) {
      throw new ServiceError("rejected", "This is a demo. Only guides marked synthetic can be imported.");
    }
    if (await this.store.exists(keyFor(doc.guide_id))) {
      throw new ServiceError("conflict", "A guide with this ID is already in Imprint.");
    }

    const attestations = Array.isArray(doc.attestations) ? doc.attestations : [];
    if (attestations.length > 0) {
      for (const att of attestations) {
        // Binding only: no trust anchors, so nothing is reported as trusted here.
        const report = await verifyAttestation(doc as never, att as never, { trustAnchors: [] });
        if (report.binding !== "ok") {
          throw new ServiceError(
            "rejected",
            "This file carries a signature that no longer matches its content. It may have been changed after signing, so it was not imported.",
          );
        }
      }
    }

    const findings = this.findings(doc);
    const bytesOut = serialize(doc);
    const loss = compareForLoss(doc, parseStrict(bytesOut));
    if (loss.items.length > 0) {
      throw new ServiceError(
        "rejected",
        "Imprint could not store this file without changing it, so it was not imported.",
      );
    }
    const key = await this.store.create(doc.guide_id, bytesOut);
    let importedAsFrozen = false;
    if (attestations.length > 0) {
      const payload = withoutExcluded(doc);
      await this.store.freeze(
        key,
        {
          revision_id: doc.revision_id,
          payload_digest: await payloadDigest(payload as never),
          frozen_at: new Date().toISOString(),
          openscg_spec: SPEC_VERSION,
        },
        canonicalize(payload),
      );
      importedAsFrozen = true;
    }
    return { key, findings, loss, importedAsFrozen };
  }

  async revision(
    key: string,
    revisionId: string,
  ): Promise<{ record: FreezeRecord; bytes: Uint8Array; doc: Doc }> {
    try {
      const { record, guide } = await this.store.readRevision(key, revisionId);
      return { record, bytes: guide, doc: obj(parseStrict(guide)) };
    } catch (e) {
      if (e instanceof StoreError) throw new ServiceError("not_found", e.message);
      throw e;
    }
  }
}
