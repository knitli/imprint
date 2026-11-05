// SPDX-License-Identifier: AGPL-3.0-only
//
// One view model for every human-readable rendition, so the PDF and the
// workbook print the same content (M-07). Built from one guide revision.

import { type Digest, type Finding, payloadDigest, SPEC_VERSION, validate } from "@knitli/openscg";
import type { Doc } from "../core/service.ts";

const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/**
 * What a rendition says about approval. A rendition never claims more than
 * Imprint knows (M-10): a draft says it is not approved, and a frozen revision
 * says its approval is recorded elsewhere.
 */
export type RenditionStatus = "draft" | "candidate";

export const STATUS_LABEL: Record<RenditionStatus, string> = {
  draft: "DRAFT / NOT APPROVED",
  // Renditions of a frozen revision never change, so they cannot say whether
  // it was later approved. They point to the attestation instead.
  candidate: "FROZEN REVISION / APPROVAL NOT SHOWN IN THIS FILE",
};

export interface EntryModel {
  readonly id: string;
  readonly kind: "element" | "compilation";
  readonly portion: string;
  readonly description: string;
  readonly level: string;
  readonly levelConditions: string;
  readonly regime: string;
  readonly condition: string;
  readonly exceptions: string;
  readonly references: string;
  readonly controls: string;
  readonly reason: string;
  readonly declassification: string;
  readonly sources: string;
  readonly statements: string;
  readonly notes: string;
}

/** Short text for the diagonal watermark; the full label is in the notice and footer. */
export const WATERMARK: Record<RenditionStatus, string> = {
  draft: "DRAFT / NOT APPROVED",
  candidate: "FROZEN REVISION",
};

export interface GuideModel {
  readonly status: RenditionStatus;
  readonly statusLabel: string;
  readonly watermark: string;
  readonly synthetic: boolean;
  readonly title: string;
  readonly banner: string;
  readonly classification: string;
  readonly guideId: string;
  readonly revisionId: string;
  readonly digest: Digest;
  readonly openscg: string;
  readonly facts: readonly { label: string; value: string }[];
  readonly authorityBlock: readonly { label: string; value: string }[];
  readonly introduction: string;
  readonly openFindings: readonly string[];
  readonly groups: readonly {
    title: string;
    portion: string;
    description: string;
    entries: readonly EntryModel[];
  }[];
}

export const LEVEL_WORDS: Record<string, string> = {
  U: "UNCLASSIFIED",
  C: "CONFIDENTIAL",
  S: "SECRET",
  TS: "TOP SECRET",
};

export function describeDeclassification(d: Doc | undefined): string {
  if (!d?.kind) return "";
  switch (d.kind) {
    case "date":
      return `On ${str(d.date)}`;
    case "event":
      return `When this event happens: ${str(d.event_text)}`;
    case "relative_to_record_creation":
      // Stays relative. Never converted to a calendar date (spec 4.6).
      return `${str(d.years)} years after the record containing the information was created`;
    case "exemption": {
      const until = d.until_date
        ? `, until ${str(d.until_date)}`
        : d.until_event_text
          ? `, until: ${str(d.until_event_text)}`
          : "";
      const ev = obj(d.authority);
      const evidence = ev.reference
        ? `; authority evidence recorded (${str(ev.reference)}), not verified by Imprint`
        : "; no authority evidence recorded";
      return `Exempt: ${str(d.code)} (claimed${evidence})${until}`;
    }
    default:
      return str(d.kind);
  }
}

function entryModel(e: Doc): EntryModel {
  const range = obj(e.level_range);
  const reason = obj(e.reason);
  const st = obj(e.statements);
  return {
    id: str(e.entry_id),
    kind: e.kind === "compilation" ? "compilation" : "element",
    portion: str(e.portion_marking),
    description: str(e.description),
    level: e.level_range !== undefined ? `${str(range.lowest)} to ${str(range.highest)}` : str(e.level),
    levelConditions: str(range.condition_text),
    regime: e.regime === "aea" ? "Atomic Energy Act information (not supported in OpenSCG 0.1)" : "",
    condition: str(e.condition_text),
    exceptions: str(e.exceptions_text),
    references: arr(e.references).map(str).join(", "),
    controls: arr(e.controls)
      .map(obj)
      .map((c) => `${str(c.marking)}${c.note ? ` (${str(c.note)})` : ""}`)
      .join("; "),
    reason: e.reason ? `${arr(reason.categories).map(str).join(", ")}. ${str(reason.explanation)}` : "",
    declassification: describeDeclassification(e.declassification ? obj(e.declassification) : undefined),
    sources: arr(e.sources)
      .map(obj)
      .map((s) => str(s.citation) + (s.uri ? ` <${str(s.uri)}>` : ""))
      .join("; "),
    statements: [
      st.value ? `Value: ${str(st.value)}` : "",
      st.damage ? `Damage: ${str(st.damage)}` : "",
      st.unclassified ? `Unclassified: ${str(st.unclassified)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    notes: str(e.notes),
  };
}

export async function buildModel(guide: Doc, status: RenditionStatus): Promise<GuideModel> {
  const findings: Finding[] = validate(guide);
  const markings = obj(guide.document_markings);
  const org = obj(guide.issuing_organization);
  const poc = obj(guide.point_of_contact);
  const oca = obj(guide.oca);
  const dates = obj(guide.dates);
  const signer = obj(obj(guide.authority).claimed_signer);
  const join = (...xs: unknown[]) => xs.map(str).filter(Boolean).join(", ");
  const facts = [
    { label: "Subject", value: str(guide.subject) },
    { label: "Scope", value: str(guide.scope) },
    { label: "Issuing organization", value: join(org.name, org.identifier) },
    {
      label: "Original classification authority",
      value: join(oca.name, oca.position, oca.personal_identifier),
    },
    {
      label: "Point of contact",
      value: join(poc.name, poc.position, poc.organization, poc.email, poc.phone),
    },
    { label: "Issued", value: str(dates.issued) },
    { label: "Last reviewed", value: str(dates.last_reviewed) },
    { label: "Effective", value: str(dates.effective) },
    { label: "Next review due", value: str(dates.next_review_due) },
    {
      label: "Expected signer (claimed)",
      value: join(signer.name, signer.position, signer.personal_identifier),
    },
    { label: "Profile", value: str(guide.profile) },
  ].filter((f) => f.value);
  const cab = obj(markings.classification_authority_block);
  const authorityBlock = [
    { label: "Classified by", value: str(cab.classified_by) },
    { label: "Derived from", value: str(cab.derived_from) },
    { label: "Reason", value: str(cab.reason) },
    { label: "Declassify on", value: str(cab.declassify_on) },
  ].filter((f) => f.value);

  const entries = arr(guide.entries).map(obj);
  const sections = arr(guide.sections).map(obj);
  const groups = sections.map((s) => ({
    title: str(s.title),
    portion: str(s.portion_marking),
    description: str(s.description),
    entries: entries.filter((e) => e.section_id === s.section_id).map(entryModel),
  }));
  const known = new Set(sections.map((s) => s.section_id));
  const loose = entries.filter((e) => !e.section_id || !known.has(e.section_id)).map(entryModel);
  if (loose.length)
    groups.push({
      title: sections.length ? "Other entries" : "Entries",
      portion: "",
      description: "",
      entries: loose,
    });

  const classification = str(markings.classification);
  return {
    status,
    statusLabel: STATUS_LABEL[status],
    watermark: WATERMARK[status],
    synthetic: guide.synthetic === true,
    title: str(guide.title),
    // The banner is whatever an authorized person recorded; never computed from entries (spec 4.3).
    banner: str(markings.banner) || LEVEL_WORDS[classification] || "MARKINGS NOT SET",
    classification,
    guideId: str(guide.guide_id),
    revisionId: str(guide.revision_id),
    digest: await payloadDigest(guide as never),
    openscg: SPEC_VERSION,
    facts,
    authorityBlock,
    introduction: str(guide.introduction),
    openFindings: findings.map(
      (f) => `${f.message} (${f.code}, ${f.severity.replace("_", " ")}, at ${f.pointer || "/"})`,
    ),
    groups,
  };
}
