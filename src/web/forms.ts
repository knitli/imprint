// SPDX-License-Identifier: AGPL-3.0-only
//
// Turn submitted forms into guide data.
//
// The rule: a form error is anything that would make the file structurally
// invalid (a wrong type, a bad date, a required part missing). Those stop the
// save and are shown next to the field. Everything else is saved and judged by
// OpenSCG's semantic checks, because a draft may contain errors (requirements
// §3 step 3). Keeping drafts structurally valid matters: OpenSCG skips its
// semantic checks entirely while a structural error is present.
//
// Each parser updates only the fields its form owns. Anything else in the
// guide or entry, such as extensions or history, is carried over untouched.

import type { Doc } from "../core/service.ts";
import { LEVELS, PROFILES } from "../core/service.ts";

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export interface ParseResult<T> {
  readonly value: T;
  readonly errors: readonly FieldError[];
}

export const CATEGORIES = [
  "1.4(a)",
  "1.4(b)",
  "1.4(c)",
  "1.4(d)",
  "1.4(e)",
  "1.4(f)",
  "1.4(g)",
  "1.4(h)",
] as const;
export const CONTROL_KINDS = ["dissemination", "cui", "handling", "sci", "sap", "other"] as const;
export const EVIDENCE_KINDS = ["iscap_approval", "agency_notice", "delegation", "other"] as const;
export const MARKING_REVIEW = ["not_started", "pending", "complete"] as const;
export const EXEMPTION_CODE = /^(25X[1-9]|50X1-HUM|50X2-WMD|50X[1-9]|75X[1-9])$/;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHORT = 1000;
const LONG = 100_000;

/** Submitted form values. Repeated names keep every value. */
export type Form = URLSearchParams;

const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});

class Collector {
  readonly errors: FieldError[] = [];
  readonly form: Form;
  constructor(form: Form) {
    this.form = form;
  }

  error(field: string, message: string): void {
    this.errors.push({ field, message });
  }

  /** Trimmed text, or undefined when empty. Checks the length limit. */
  text(field: string, max = SHORT): string | undefined {
    const raw = this.form.get(field);
    if (raw == null) return undefined;
    // Normalise line endings from browsers; keep the author's text otherwise.
    const v = raw.replace(/\r\n?/g, "\n").trim();
    if (!v) return undefined;
    if (v.length > max) {
      this.error(field, `This is too long: at most ${max.toLocaleString("en-US")} characters.`);
      return undefined;
    }
    return v;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], label: string): T | undefined {
    const v = this.form.get(field)?.trim();
    if (!v) return undefined;
    if (!(allowed as readonly string[]).includes(v)) {
      this.error(field, `Choose a valid ${label}.`);
      return undefined;
    }
    return v as T;
  }

  date(field: string): string | undefined {
    const v = this.text(field);
    if (v === undefined) return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (
      !m ||
      !d ||
      d.getUTCFullYear() !== Number(m[1]) ||
      d.getUTCMonth() + 1 !== Number(m[2]) ||
      d.getUTCDate() !== Number(m[3])
    ) {
      this.error(field, "Enter a real date as YYYY-MM-DD, for example 2031-10-01.");
      return undefined;
    }
    return v;
  }

  uri(field: string): string | undefined {
    const v = this.text(field, 2048);
    if (v === undefined) return undefined;
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(v)) {
      this.error(field, "Enter a full address that starts with its scheme, for example https:// or urn:.");
      return undefined;
    }
    return v;
  }

  localId(field: string, label: string): string | undefined {
    const v = this.text(field, 64);
    if (v === undefined) return undefined;
    if (!LOCAL_ID.test(v)) {
      this.error(
        field,
        `${label} must start with a letter or number and use only letters, numbers, dots, hyphens or underscores (at most 64).`,
      );
      return undefined;
    }
    return v;
  }

  all(field: string): string[] {
    return this.form
      .getAll(field)
      .map((v) => v.trim())
      .filter(Boolean);
  }
}

/** Put a value in an object, or remove the key when the value is undefined or an empty object/array. */
function put(target: Doc, key: string, value: unknown): void {
  const empty =
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
  if (empty) delete target[key];
  else target[key] = value;
}

/** Drop undefined members so optional fields disappear instead of becoming null. */
function compact(o: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

/** Indexes of repeated rows present in the form, for names like `source_citation_3`. */
function rowIndexes(form: Form, prefix: string): number[] {
  const out = new Set<number>();
  for (const name of form.keys()) {
    const m = new RegExp(`^${prefix}_(\\d{1,3})$`).exec(name);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

function evidence(c: Collector, prefix: string): Doc | undefined {
  const kind = c.oneOf(`${prefix}_kind`, EVIDENCE_KINDS, "kind of evidence");
  const reference = c.text(`${prefix}_reference`);
  const date = c.date(`${prefix}_date`);
  const uri = c.uri(`${prefix}_uri`);
  if (!kind && !reference && !date && !uri) return undefined;
  if (!reference) {
    c.error(`${prefix}_reference`, "Say where the evidence can be found, for example a memo number.");
    return undefined;
  }
  return compact({ kind, reference, date, uri });
}

/** Parse the entry editor. `existing` is the entry being edited, or {} for a new one. */
export function parseEntryForm(form: Form, existing: Doc): ParseResult<Doc> {
  const c = new Collector(form);
  const entry: Doc = { ...existing };

  const entryId = c.localId("entry_id", "The entry ID");
  if (!entryId && !c.errors.some((e) => e.field === "entry_id"))
    c.error("entry_id", "Give the entry an ID, for example perf-range.");
  put(entry, "entry_id", entryId);
  entry.kind = c.oneOf("kind", ["element", "compilation"] as const, "kind of entry") ?? "element";
  put(entry, "section_id", c.localId("section_id", "The section"));
  put(entry, "portion_marking", c.text("portion_marking"));
  const regime = c.oneOf("regime", ["cnsi", "aea"] as const, "regime");
  put(entry, "regime", regime === "aea" ? "aea" : undefined);

  const description = c.text("description", LONG);
  if (!description && !c.errors.some((e) => e.field === "description")) {
    c.error("description", "Describe the information this entry covers.");
  }
  put(entry, "description", description);

  // Level: exactly one of a single level or a range with its conditions (spec 4.4).
  const mode = form.get("level_mode") === "range" ? "range" : "single";
  if (mode === "single") {
    const level = c.oneOf("level", LEVELS, "level");
    if (!level && !c.errors.some((e) => e.field === "level"))
      c.error("level", "Choose a classification level.");
    put(entry, "level", level);
    delete entry.level_range;
  } else {
    const lowest = c.oneOf("range_lowest", LEVELS, "lowest level");
    const highest = c.oneOf("range_highest", LEVELS, "highest level");
    const condition = c.text("range_condition", LONG);
    if (!lowest) c.error("range_lowest", "Choose the lowest level.");
    if (!highest) c.error("range_highest", "Choose the highest level.");
    if (!condition) c.error("range_condition", "A range needs the conditions that decide the level.");
    put(
      entry,
      "level_range",
      lowest && highest && condition ? { lowest, highest, condition_text: condition } : undefined,
    );
    delete entry.level;
  }

  put(entry, "condition_text", c.text("condition_text", LONG));
  put(entry, "exceptions_text", c.text("exceptions_text", LONG));

  const refs = c.all("references");
  for (const r of refs)
    if (!LOCAL_ID.test(r)) c.error("references", "One of the selected entries has an invalid ID.");
  put(entry, "references", [...new Set(refs.filter((r) => LOCAL_ID.test(r)))]);

  const controls: Doc[] = [];
  for (const i of rowIndexes(form, "control_marking")) {
    if (form.get(`control_remove_${i}`)) continue;
    const marking = c.text(`control_marking_${i}`);
    const kind = c.oneOf(`control_kind_${i}`, CONTROL_KINDS, "kind of control");
    const note = c.text(`control_note_${i}`, LONG);
    if (!marking && !note) continue;
    if (!marking) {
      c.error(`control_marking_${i}`, "Enter the marking, for example NOFORN.");
      continue;
    }
    controls.push(compact({ marking, kind: kind ?? "other", note }));
  }
  put(entry, "controls", controls);

  const categories = c.all("reason_categories");
  const validCats = categories.filter((v) => (CATEGORIES as readonly string[]).includes(v));
  if (validCats.length !== categories.length) c.error("reason_categories", "Choose valid categories.");
  const explanation = c.text("reason_explanation", LONG);
  if (validCats.length && !explanation)
    c.error("reason_explanation", "Explain briefly why the information is classified.");
  if (explanation && !validCats.length)
    c.error("reason_categories", "Choose at least one E.O. 13526 section 1.4 category.");
  put(
    entry,
    "reason",
    validCats.length && explanation
      ? { categories: CATEGORIES.filter((x) => validCats.includes(x)), explanation }
      : undefined,
  );

  put(entry, "declassification", parseDeclassification(c));

  const sources: Doc[] = [];
  for (const i of rowIndexes(form, "source_citation")) {
    if (form.get(`source_remove_${i}`)) continue;
    const citation = c.text(`source_citation_${i}`);
    const uri = c.uri(`source_uri_${i}`);
    if (!citation && !uri) continue;
    if (!citation) {
      c.error(`source_citation_${i}`, "Give the source a citation.");
      continue;
    }
    sources.push(compact({ citation, uri }));
  }
  put(entry, "sources", sources);

  put(
    entry,
    "statements",
    compact({
      value: c.text("statement_value", LONG),
      damage: c.text("statement_damage", LONG),
      unclassified: c.text("statement_unclassified", LONG),
    }),
  );
  put(entry, "notes", c.text("notes", LONG));
  return { value: entry, errors: c.errors };
}

function parseDeclassification(c: Collector): Doc | undefined {
  const kind = c.oneOf(
    "declass_kind",
    ["none", "date", "event", "relative_to_record_creation", "exemption"] as const,
    "kind of declassification instruction",
  );
  switch (kind) {
    case "date": {
      const date = c.date("declass_date");
      if (!date && !c.errors.some((e) => e.field === "declass_date"))
        c.error("declass_date", "Enter the declassification date.");
      return date ? { kind, date } : undefined;
    }
    case "event": {
      const event_text = c.text("declass_event", LONG);
      if (!event_text) c.error("declass_event", "Describe the event that ends classification.");
      return event_text ? { kind, event_text } : undefined;
    }
    case "relative_to_record_creation": {
      const raw = c.text("declass_years", 10);
      const years = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(years) || years < 1 || years > 999) {
        c.error("declass_years", "Enter a whole number of years, for example 25.");
        return undefined;
      }
      return { kind, years };
    }
    case "exemption": {
      const code = c.text("exempt_code", 16)?.toUpperCase();
      if (!code || !EXEMPTION_CODE.test(code)) {
        c.error("exempt_code", "Enter an exemption code such as 25X1, 50X1-HUM or 75X3.");
        return undefined;
      }
      return compact({
        kind,
        code,
        until_date: c.date("exempt_until_date"),
        until_event_text: c.text("exempt_until_event", LONG),
        authority: evidence(c, "evidence"),
      });
    }
    default:
      return undefined;
  }
}

/** Parse the guide details form. */
export function parseDetailsForm(form: Form, doc: Doc, options: { demo: boolean }): ParseResult<Doc> {
  const c = new Collector(form);
  const next: Doc = { ...doc };

  const title = c.text("title");
  if (!title && !c.errors.some((e) => e.field === "title")) c.error("title", "Give the guide a title.");
  put(next, "title", title);
  const revisionId = c.localId("revision_id", "The revision ID");
  if (!revisionId && !c.errors.some((e) => e.field === "revision_id"))
    c.error("revision_id", "Give this revision an ID, for example r1.");
  put(next, "revision_id", revisionId);
  next.profile = c.oneOf("profile", PROFILES, "profile") ?? next.profile;
  const synthetic = form.get("synthetic") === "on";
  if (options.demo && !synthetic)
    c.error("synthetic", "This is a demo. Every guide must be marked synthetic.");
  put(next, "synthetic", synthetic ? true : undefined);

  put(next, "subject", c.text("subject", LONG));
  put(next, "scope", c.text("scope", LONG));
  put(next, "introduction", c.text("introduction", LONG));

  const orgName = c.text("org_name");
  const orgId = c.text("org_identifier");
  if (orgId && !orgName) c.error("org_name", "Give the organization's name.");
  put(next, "issuing_organization", orgName ? compact({ name: orgName, identifier: orgId }) : undefined);

  const email = c.text("poc_email", 320);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email))
    c.error("poc_email", "Enter an email address like name@example.gov.");
  put(
    next,
    "point_of_contact",
    compact({
      name: c.text("poc_name"),
      position: c.text("poc_position"),
      organization: c.text("poc_organization"),
      email: email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined,
      phone: c.text("poc_phone"),
    }),
  );
  put(
    next,
    "oca",
    compact({
      ...obj(doc.oca),
      name: c.text("oca_name"),
      position: c.text("oca_position"),
      personal_identifier: c.text("oca_personal_identifier"),
      highest_level: c.oneOf("oca_highest_level", LEVELS, "level"),
    }),
  );
  put(
    next,
    "dates",
    compact({
      issued: c.date("date_issued"),
      last_reviewed: c.date("date_last_reviewed"),
      effective: c.date("date_effective"),
      next_review_due: c.date("date_next_review_due"),
    }),
  );

  // Authority claims: who is expected to sign, and under what delegation (spec 4.7).
  const signer = compact({
    name: c.text("signer_name"),
    position: c.text("signer_position"),
    personal_identifier: c.text("signer_personal_identifier"),
  });
  const delegationLevel = c.oneOf("delegation_highest_level", LEVELS, "level");
  const delegationProgram = c.text("delegation_program");
  const delegationEvidence = evidence(c, "delegation_evidence");
  const anyDelegation = delegationLevel || delegationProgram || delegationEvidence;
  if (anyDelegation && !delegationLevel) {
    c.error("delegation_highest_level", "Say the highest level the claimed delegation covers.");
  }
  const anySigner = Object.keys(signer).length > 0;
  if ((anySigner || anyDelegation) && !signer.name && !signer.personal_identifier) {
    c.error("signer_name", "Give the expected signer's name or personal identifier.");
  }
  put(
    next,
    "authority",
    signer.name || signer.personal_identifier
      ? compact({
          ...obj(doc.authority),
          claimed_signer: signer,
          claimed_delegation: delegationLevel
            ? compact({
                highest_level: delegationLevel,
                program: delegationProgram,
                evidence: delegationEvidence,
              })
            : undefined,
        })
      : undefined,
  );
  return { value: next, errors: c.errors };
}

/** Parse the document markings form: the guide's own protection (spec 4.3). */
export function parseMarkingsForm(form: Form, doc: Doc): ParseResult<Doc> {
  const c = new Collector(form);
  const next: Doc = { ...doc };
  const markings: Doc = { ...obj(doc.document_markings) };
  const classification = c.oneOf("classification", LEVELS, "classification");
  if (!classification && !c.errors.some((e) => e.field === "classification")) {
    c.error("classification", "Choose the guide's own classification.");
  }
  put(markings, "classification", classification);
  put(markings, "banner", c.text("banner"));
  const controls = (c.text("controls", LONG) ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (controls.some((s) => s.length > SHORT))
    c.error("controls", "Each control must be at most 1,000 characters.");
  put(
    markings,
    "controls",
    controls.filter((s) => s.length <= SHORT),
  );
  put(
    markings,
    "classification_authority_block",
    compact({
      classified_by: c.text("cab_classified_by"),
      derived_from: c.text("cab_derived_from"),
      reason: c.text("cab_reason"),
      declassify_on: c.text("cab_declassify_on"),
    }),
  );
  const status = c.oneOf("review_status", MARKING_REVIEW, "review status");
  const reviewedBy = c.text("reviewed_by");
  const reviewedOn = c.date("reviewed_on");
  if (!status && (reviewedBy || reviewedOn))
    c.error("review_status", "Say whether the markings review is complete.");
  put(
    markings,
    "review",
    status ? compact({ status, reviewed_by: reviewedBy, reviewed_on: reviewedOn }) : undefined,
  );
  next.document_markings = markings;
  return { value: next, errors: c.errors };
}

/** Parse the sections form: rows of section_id, title, portion marking and description. */
export function parseSectionsForm(form: Form, doc: Doc): ParseResult<Doc> {
  const c = new Collector(form);
  const next: Doc = { ...doc };
  const existing = Array.isArray(doc.sections) ? (doc.sections as unknown[]) : [];
  const sections: Doc[] = [];
  for (const i of rowIndexes(form, "section_id")) {
    if (form.get(`section_remove_${i}`)) continue;
    const id = c.localId(`section_id_${i}`, "The section ID");
    const title = c.text(`section_title_${i}`);
    const portion = c.text(`section_portion_${i}`);
    const description = c.text(`section_description_${i}`, LONG);
    if (!id && !title && !portion && !description && !c.errors.some((e) => e.field === `section_id_${i}`))
      continue;
    if (!id && !c.errors.some((e) => e.field === `section_id_${i}`))
      c.error(`section_id_${i}`, "Give the section an ID.");
    if (!title) c.error(`section_title_${i}`, "Give the section a title.");
    if (id && title) {
      sections.push(
        compact({ ...obj(existing[i]), section_id: id, title, portion_marking: portion, description }),
      );
    }
  }
  put(next, "sections", sections);
  return { value: next, errors: c.errors };
}

// ---- Guide data to form values ----------------------------------------------
// Forms always render from a Form. On first view it comes from the stored
// guide; after a refused save it is what the person submitted, so nothing they
// typed is lost.

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function set(f: Form, name: string, v: unknown): void {
  const text = s(v);
  if (text) f.set(name, text);
}

/** Extra blank rows offered for repeated fields, so people can add one without scripts. */
export const BLANK_ROWS = 2;

export function entryToForm(entry: Doc): Form {
  const f = new URLSearchParams();
  set(f, "entry_id", entry.entry_id);
  set(f, "kind", entry.kind ?? "element");
  set(f, "section_id", entry.section_id);
  set(f, "portion_marking", entry.portion_marking);
  set(f, "regime", entry.regime ?? "cnsi");
  set(f, "description", entry.description);
  const range = obj(entry.level_range);
  if (entry.level_range !== undefined) {
    f.set("level_mode", "range");
    set(f, "range_lowest", range.lowest);
    set(f, "range_highest", range.highest);
    set(f, "range_condition", range.condition_text);
  } else {
    f.set("level_mode", "single");
    set(f, "level", entry.level);
  }
  set(f, "condition_text", entry.condition_text);
  set(f, "exceptions_text", entry.exceptions_text);
  for (const r of arr(entry.references)) f.append("references", s(r));
  const controls = arr(entry.controls).map(obj);
  controls.forEach((ctl, i) => {
    f.set(`control_marking_${i}`, s(ctl.marking));
    set(f, `control_kind_${i}`, ctl.kind);
    set(f, `control_note_${i}`, ctl.note);
  });
  for (let i = controls.length; i < controls.length + BLANK_ROWS; i++) f.set(`control_marking_${i}`, "");
  const reason = obj(entry.reason);
  for (const cat of arr(reason.categories)) f.append("reason_categories", s(cat));
  set(f, "reason_explanation", reason.explanation);
  const d = obj(entry.declassification);
  f.set("declass_kind", s(d.kind) || "none");
  set(f, "declass_date", d.date);
  set(f, "declass_event", d.event_text);
  set(f, "declass_years", d.years);
  set(f, "exempt_code", d.code);
  set(f, "exempt_until_date", d.until_date);
  set(f, "exempt_until_event", d.until_event_text);
  const ev = obj(d.authority);
  set(f, "evidence_kind", ev.kind);
  set(f, "evidence_reference", ev.reference);
  set(f, "evidence_date", ev.date);
  set(f, "evidence_uri", ev.uri);
  const sources = arr(entry.sources).map(obj);
  sources.forEach((src, i) => {
    f.set(`source_citation_${i}`, s(src.citation));
    set(f, `source_uri_${i}`, src.uri);
  });
  for (let i = sources.length; i < sources.length + BLANK_ROWS; i++) f.set(`source_citation_${i}`, "");
  const st = obj(entry.statements);
  set(f, "statement_value", st.value);
  set(f, "statement_damage", st.damage);
  set(f, "statement_unclassified", st.unclassified);
  set(f, "notes", entry.notes);
  return f;
}

export function detailsToForm(doc: Doc): Form {
  const f = new URLSearchParams();
  set(f, "title", doc.title);
  set(f, "revision_id", doc.revision_id);
  set(f, "profile", doc.profile);
  if (doc.synthetic === true) f.set("synthetic", "on");
  set(f, "subject", doc.subject);
  set(f, "scope", doc.scope);
  set(f, "introduction", doc.introduction);
  const org = obj(doc.issuing_organization);
  set(f, "org_name", org.name);
  set(f, "org_identifier", org.identifier);
  const poc = obj(doc.point_of_contact);
  set(f, "poc_name", poc.name);
  set(f, "poc_position", poc.position);
  set(f, "poc_organization", poc.organization);
  set(f, "poc_email", poc.email);
  set(f, "poc_phone", poc.phone);
  const oca = obj(doc.oca);
  set(f, "oca_name", oca.name);
  set(f, "oca_position", oca.position);
  set(f, "oca_personal_identifier", oca.personal_identifier);
  set(f, "oca_highest_level", oca.highest_level);
  const dates = obj(doc.dates);
  set(f, "date_issued", dates.issued);
  set(f, "date_last_reviewed", dates.last_reviewed);
  set(f, "date_effective", dates.effective);
  set(f, "date_next_review_due", dates.next_review_due);
  const auth = obj(doc.authority);
  const signer = obj(auth.claimed_signer);
  set(f, "signer_name", signer.name);
  set(f, "signer_position", signer.position);
  set(f, "signer_personal_identifier", signer.personal_identifier);
  const del = obj(auth.claimed_delegation);
  set(f, "delegation_highest_level", del.highest_level);
  set(f, "delegation_program", del.program);
  const dev = obj(del.evidence);
  set(f, "delegation_evidence_kind", dev.kind);
  set(f, "delegation_evidence_reference", dev.reference);
  set(f, "delegation_evidence_date", dev.date);
  set(f, "delegation_evidence_uri", dev.uri);
  return f;
}

export function markingsToForm(doc: Doc): Form {
  const f = new URLSearchParams();
  const m = obj(doc.document_markings);
  set(f, "classification", m.classification);
  set(f, "banner", m.banner);
  const controls = arr(m.controls).map(s).filter(Boolean);
  if (controls.length) f.set("controls", controls.join("\n"));
  const cab = obj(m.classification_authority_block);
  set(f, "cab_classified_by", cab.classified_by);
  set(f, "cab_derived_from", cab.derived_from);
  set(f, "cab_reason", cab.reason);
  set(f, "cab_declassify_on", cab.declassify_on);
  const review = obj(m.review);
  set(f, "review_status", review.status);
  set(f, "reviewed_by", review.reviewed_by);
  set(f, "reviewed_on", review.reviewed_on);
  return f;
}

export function sectionsToForm(doc: Doc): Form {
  const f = new URLSearchParams();
  const sections = arr(doc.sections).map(obj);
  sections.forEach((sec, i) => {
    f.set(`section_id_${i}`, s(sec.section_id));
    set(f, `section_title_${i}`, sec.title);
    set(f, `section_portion_${i}`, sec.portion_marking);
    set(f, `section_description_${i}`, sec.description);
  });
  for (let i = sections.length; i < sections.length + BLANK_ROWS; i++) f.set(`section_id_${i}`, "");
  return f;
}

/** Row indexes present in a form, for rendering repeated rows. */
export function rows(form: Form, prefix: string): number[] {
  return rowIndexes(form, prefix);
}
