// SPDX-License-Identifier: AGPL-3.0-only
//
// Page bodies. Each function returns a Safe fragment; the server wraps it in
// the layout. All guide text is escaped by the `html` template.

import type { Finding } from "@knitli/openscg";
import { approvalText } from "@knitli/openscg";
import type { Doc, GuideSummary, GuideView } from "../core/service.ts";
import { LEVELS, PROFILES } from "../core/service.ts";
import type { FreezeRecord } from "../core/store.ts";
import {
  CATEGORIES,
  CONTROL_KINDS,
  EVIDENCE_KINDS,
  type FieldError,
  type Form,
  MARKING_REVIEW,
  rows,
} from "./forms.ts";
import { html, type Safe } from "./html.ts";
import { choices, errorSummary, findingsList, input, select, submit, textarea } from "./ui.ts";

const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const LEVEL_NAMES: Record<string, string> = {
  U: "Unclassified (U)",
  C: "Confidential (C)",
  S: "Secret (S)",
  TS: "Top Secret (TS)",
};
const levelOptions = LEVELS.map((l) => ({ value: l, label: LEVEL_NAMES[l] ?? l }));

export const CATEGORY_NAMES: Record<string, string> = {
  "1.4(a)": "1.4(a) Military plans, weapons systems, or operations",
  "1.4(b)": "1.4(b) Foreign government information",
  "1.4(c)": "1.4(c) Intelligence activities, intelligence sources or methods, or cryptology",
  "1.4(d)":
    "1.4(d) Foreign relations or foreign activities of the United States, including confidential sources",
  "1.4(e)": "1.4(e) Scientific, technological, or economic matters relating to national security",
  "1.4(f)": "1.4(f) U.S. Government programs for safeguarding nuclear materials or facilities",
  "1.4(g)":
    "1.4(g) Vulnerabilities or capabilities of systems, installations, infrastructures, projects, plans, or protection services relating to national security",
  "1.4(h)": "1.4(h) The development, production, or use of weapons of mass destruction",
};

function levelText(entry: Doc): string {
  const range = obj(entry.level_range);
  if (entry.level_range !== undefined) return `${str(range.lowest)} to ${str(range.highest)}`;
  return str(entry.level) || "not set";
}

// ---- Home --------------------------------------------------------------------

export function homePage(
  guides: readonly GuideSummary[],
  demo: boolean,
  form: Form,
  errors: readonly FieldError[],
): Safe {
  return html`
<h1>Security classification guides</h1>
${errorSummary(errors)}
${
  guides.length
    ? html`<table class="usa-table usa-table--borderless imprint-table">
  <caption>Your guides</caption>
  <thead><tr><th scope="col">Title</th><th scope="col">Revision</th><th scope="col">State</th></tr></thead>
  <tbody>${guides.map(
    (g) =>
      html`<tr><th scope="row"><a href="/guides/${g.key}">${g.title}</a>${g.synthetic ? html` <span class="usa-tag">Synthetic</span>` : ""}</th><td>${g.revisionId}</td><td>${g.frozen ? "Frozen candidate" : "Draft"}</td></tr>`,
  )}</tbody>
</table>`
    : html`<p>No guides yet. Start one below, or import an OpenSCG file.</p>`
}
<h2>Start a new guide</h2>
<form class="usa-form usa-form--large" method="post" action="/guides" novalidate>
  ${input({ name: "title", label: "Title", value: form.get("title") ?? "", errors, required: true })}
  ${select({
    name: "classification",
    label: "The guide's own classification",
    hint: "The protection of the guide document itself, chosen by an authorized person. It is not worked out from the entries.",
    options: levelOptions,
    value: form.get("classification") ?? "",
    blank: "- Select -",
    errors,
    required: true,
  })}
  ${select({
    name: "profile",
    label: "Profile",
    hint: "Which OpenSCG rules apply. The DoD profile is a placeholder that has not been verified with DoD.",
    options: PROFILES.map((p) => ({
      value: p,
      label:
        p === "cnsi-core"
          ? "CNSI core (E.O. 13526, 32 CFR 2001.15)"
          : "DoDM 5200.45 (unverified placeholder)",
    })),
    value: form.get("profile") ?? "cnsi-core",
    errors,
  })}
  ${choices({
    name: "synthetic",
    label: "Synthetic guide",
    type: "checkbox",
    options: [
      {
        value: "on",
        label: "This guide is invented, for training or testing",
        hint: demo ? "Required in the demo." : undefined,
      },
    ],
    selected: demo || form.get("synthetic") === "on" ? ["on"] : [],
    errors,
  })}
  ${submit("Start guide")}
</form>
<h2>Import an OpenSCG file</h2>
<form class="usa-form usa-form--large" method="post" action="/guides/import" enctype="multipart/form-data">
  <div class="usa-form-group">
    <label class="usa-label" for="f-file">OpenSCG JSON file</label>
    <div class="usa-hint" id="f-file-hint">Imprint checks the file strictly. A signed file is imported only if its signature still matches its content.</div>
    <input class="usa-file-input" id="f-file" name="file" type="file" accept=".json,application/json" aria-describedby="f-file-hint">
  </div>
  ${submit("Import", { secondary: true })}
</form>`;
}

// ---- Guide overview -----------------------------------------------------------

export function overviewPage(view: GuideView): Safe {
  const d = view.doc;
  const base = `/guides/${view.key}`;
  const entries = arr(d.entries).map(obj);
  const ids = entries.map((e) => str(e.entry_id));
  const markings = obj(d.document_markings);
  const state = str(obj(d.lifecycle).state);
  const editable = !view.frozen;
  return html`
<h1>${str(d.title) || "(untitled guide)"}</h1>
<ul class="usa-list usa-list--unstyled imprint-facts">
  <li><strong>Revision:</strong> ${str(d.revision_id)} (${view.frozen ? "Frozen candidate" : "Draft"})${
    !view.frozen && state && state !== "draft"
      ? html`. The file records its state as “${state}”; Imprint treats it as a draft until you freeze it.`
      : ""
  }</li>
  <li><strong>Guide ID:</strong> <span class="imprint-mono">${str(d.guide_id)}</span></li>
  <li><strong>The guide's own classification:</strong> ${LEVEL_NAMES[str(markings.classification)] ?? "not set"}${
    markings.banner ? html`, banner “${str(markings.banner)}”` : ""
  }</li>
  <li><strong>Profile:</strong> ${str(d.profile)}</li>
</ul>
${
  view.frozen
    ? html`<div class="usa-alert usa-alert--info"><div class="usa-alert__body"><h2 class="usa-alert__heading">Revision ${str(d.revision_id)} is frozen</h2><p class="usa-alert__text">Its content can no longer change. To make changes, start a new revision; this one stays as it is.</p>
        <form method="post" action="${base}/new-revision" class="usa-form">
          ${input({ name: "revision_id", label: "New revision ID", hint: "For example r2.", value: suggestNext(str(d.revision_id)), width: "medium" })}
          ${submit("Start new revision")}
        </form></div></div>`
    : ""
}
<h2>Checks</h2>
<p class="usa-hint">OpenSCG 0.1.0 checks for completeness and consistency. Passing them does not make a guide correct, compliant or approved.</p>
${findingsList(base, view.findings, ids)}
${
  editable
    ? html`<p>${
        view.approvalReady
          ? html`<a class="usa-button" href="${base}/freeze">Freeze for approval</a>`
          : html`<span class="usa-hint">Resolve the items marked “Must fix”, “Not supported” and “Needs a person to decide” before freezing.</span>`
      }</p>`
    : ""
}
<h2>Guide</h2>
<ul class="usa-list">
  <li><a href="${base}/details">${editable ? "Edit" : "View"} guide details</a>: title, subject, scope, OCA, contacts, dates and authority claims</li>
  <li><a href="${base}/markings">${editable ? "Edit" : "View"} document markings</a>: the guide's own classification and its review</li>
  <li><a href="${base}/sections">${editable ? "Edit" : "View"} sections</a> (${arr(d.sections).length})</li>
</ul>
<h2>Entries (${entries.length})</h2>
${
  entries.length
    ? html`<table class="usa-table usa-table--borderless imprint-table">
  <caption class="usa-sr-only">Entries in this guide</caption>
  <thead><tr><th scope="col">Entry</th><th scope="col">Kind</th><th scope="col">Level</th><th scope="col">Information</th></tr></thead>
  <tbody>${entries.map(
    (e, i) =>
      html`<tr><th scope="row"><a href="${base}/entries/${i}">${str(e.entry_id) || `(entry ${i + 1})`}</a></th><td>${str(e.kind) === "compilation" ? "Compilation" : "Element"}</td><td>${levelText(e)}</td><td>${truncate(str(e.description), 160)}</td></tr>`,
  )}</tbody>
</table>`
    : html`<p>No entries yet.</p>`
}
${editable ? html`<p><a class="usa-button usa-button--outline" href="${base}/entries/new">Add an entry</a></p>` : ""}
<h2>Frozen revisions</h2>
${
  view.revisions.length
    ? html`<ul class="usa-list">${view.revisions.map(
        (r) =>
          html`<li><a href="${base}/revisions/${r.revision_id}">Revision ${r.revision_id}</a>, frozen ${r.frozen_at.slice(0, 10)}</li>`,
      )}</ul>`
    : html`<p>None yet.</p>`
}
<h2>Download</h2>
<p><a href="${base}/draft.json" download>Download the current ${view.frozen ? "revision" : "draft"} as OpenSCG JSON</a></p>`;
}

function suggestNext(rev: string): string {
  const m = /^(.*?)(\d+)$/.exec(rev);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${rev}-2`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---- Shared form wrapper -----------------------------------------------------

function formPage(opts: {
  title: string;
  action: string;
  errors: readonly FieldError[];
  readonly: boolean;
  intro?: Safe;
  body: Safe;
  submitLabel?: string;
  extra?: Safe;
}): Safe {
  return html`
<h1>${opts.title}</h1>
${errorSummary(opts.errors)}
${opts.intro ?? ""}
${
  opts.readonly
    ? html`<div class="usa-alert usa-alert--info usa-alert--slim"><div class="usa-alert__body"><p class="usa-alert__text">This revision is frozen, so this page is read-only.</p></div></div>`
    : ""
}
<form class="usa-form usa-form--large imprint-form" method="post" action="${opts.action}" novalidate>
<fieldset class="usa-fieldset"${opts.readonly ? html` disabled` : ""}>
${opts.body}
${opts.readonly ? "" : submit(opts.submitLabel ?? "Save")}
</fieldset>
</form>
${opts.extra ?? ""}`;
}

// ---- Guide details -------------------------------------------------------------

export function detailsPage(view: GuideView, f: Form, errors: readonly FieldError[], demo: boolean): Safe {
  const v = (n: string) => f.get(n) ?? "";
  const e = errors;
  return formPage({
    title: "Guide details",
    action: `/guides/${view.key}/details`,
    errors,
    readonly: view.frozen,
    body: html`
${input({ name: "title", label: "Title", value: v("title"), errors: e, required: true })}
${input({ name: "revision_id", label: "Revision ID", hint: "A short, human-readable name for this revision, for example r1.", value: v("revision_id"), errors: e, width: "medium", required: true })}
${select({ name: "profile", label: "Profile", options: PROFILES.map((p) => ({ value: p, label: p })), value: v("profile"), errors: e })}
${choices({ name: "synthetic", label: "Synthetic guide", type: "checkbox", options: [{ value: "on", label: "This guide is invented, for training or testing", hint: demo ? "Required in the demo." : undefined }], selected: f.getAll("synthetic"), errors: e })}
${textarea({ name: "subject", label: "Subject", hint: "What the guide covers (32 CFR 2001.15(b)(1)).", value: v("subject"), errors: e, rows: 3 })}
${textarea({ name: "scope", label: "Scope", hint: "What it covers and does not cover.", value: v("scope"), errors: e, rows: 3 })}
${textarea({ name: "introduction", label: "Introduction", value: v("introduction"), errors: e, rows: 5 })}
<h2>Issuing organization</h2>
${input({ name: "org_name", label: "Name", value: v("org_name"), errors: e })}
${input({ name: "org_identifier", label: "Identifier", hint: "Optional, for example an office symbol.", value: v("org_identifier"), errors: e })}
<h2>Point of contact</h2>
${input({ name: "poc_name", label: "Name", value: v("poc_name"), errors: e, autocomplete: "off" })}
${input({ name: "poc_position", label: "Position", value: v("poc_position"), errors: e })}
${input({ name: "poc_organization", label: "Organization", value: v("poc_organization"), errors: e })}
${input({ name: "poc_email", label: "Email", type: "email", value: v("poc_email"), errors: e, autocomplete: "off" })}
${input({ name: "poc_phone", label: "Phone", type: "tel", value: v("poc_phone"), errors: e, autocomplete: "off" })}
<h2>Original classification authority</h2>
<p class="usa-hint">Name and position, or a personal identifier (32 CFR 2001.15(b)(2)). The highest level is a claim; Imprint does not verify it.</p>
${input({ name: "oca_name", label: "Name", value: v("oca_name"), errors: e, autocomplete: "off" })}
${input({ name: "oca_position", label: "Position", value: v("oca_position"), errors: e })}
${input({ name: "oca_personal_identifier", label: "Personal identifier", value: v("oca_personal_identifier"), errors: e })}
${select({ name: "oca_highest_level", label: "Highest level of the OCA's authority (claimed)", options: levelOptions, value: v("oca_highest_level"), blank: "- Not stated -", errors: e })}
<h2>Dates</h2>
${input({ name: "date_issued", label: "Issued", hint: "YYYY-MM-DD", value: v("date_issued"), errors: e, width: "medium" })}
${input({ name: "date_last_reviewed", label: "Last reviewed", hint: "YYYY-MM-DD", value: v("date_last_reviewed"), errors: e, width: "medium" })}
${input({ name: "date_effective", label: "Effective", hint: "YYYY-MM-DD", value: v("date_effective"), errors: e, width: "medium" })}
${input({ name: "date_next_review_due", label: "Next review due", hint: "YYYY-MM-DD. Recording it does not perform the review.", value: v("date_next_review_due"), errors: e, width: "medium" })}
<h2>Authority claims</h2>
<p class="usa-hint">Who is expected to sign, and under what delegation. These are claims that the signer approves; a person checks them separately after signing.</p>
${input({ name: "signer_name", label: "Expected signer's name", value: v("signer_name"), errors: e, autocomplete: "off" })}
${input({ name: "signer_position", label: "Expected signer's position", value: v("signer_position"), errors: e })}
${input({ name: "signer_personal_identifier", label: "Expected signer's personal identifier", value: v("signer_personal_identifier"), errors: e })}
${select({ name: "delegation_highest_level", label: "Highest level the claimed delegation covers", options: levelOptions, value: v("delegation_highest_level"), blank: "- Not stated -", errors: e })}
${input({ name: "delegation_program", label: "Program the delegation covers", value: v("delegation_program"), errors: e })}
${evidenceFields("delegation_evidence", "Delegation evidence", f, e)}
`,
  });
}

function evidenceFields(prefix: string, legend: string, f: Form, e: readonly FieldError[]): Safe {
  const v = (n: string) => f.get(n) ?? "";
  return html`<fieldset class="usa-fieldset imprint-subgroup"><legend class="usa-legend">${legend}</legend>
<p class="usa-hint">Where proof can be found. Recording it here does not verify it.</p>
${select({ name: `${prefix}_kind`, label: "Kind of evidence", options: EVIDENCE_KINDS.map((k) => ({ value: k, label: k.replace("_", " ") })), value: v(`${prefix}_kind`), blank: "- Not stated -", errors: e })}
${input({ name: `${prefix}_reference`, label: "Reference", hint: "For example a memo or notice number.", value: v(`${prefix}_reference`), errors: e })}
${input({ name: `${prefix}_date`, label: "Date", hint: "YYYY-MM-DD", value: v(`${prefix}_date`), errors: e, width: "medium" })}
${input({ name: `${prefix}_uri`, label: "Address (URI)", value: v(`${prefix}_uri`), errors: e })}
</fieldset>`;
}

// ---- Document markings -------------------------------------------------------

export function markingsPage(view: GuideView, f: Form, errors: readonly FieldError[]): Safe {
  const v = (n: string) => f.get(n) ?? "";
  const e = errors;
  return formPage({
    title: "Document markings",
    action: `/guides/${view.key}/markings`,
    errors,
    readonly: view.frozen,
    intro: html`<p>These describe the protection of <strong>the guide document itself</strong>, not the information its entries describe. An unclassified guide can describe Secret information. Imprint never fills these in from the entries; an authorized person decides them.</p>`,
    body: html`
${select({ name: "classification", label: "Overall classification of the guide", options: levelOptions, value: v("classification"), blank: "- Select -", errors: e, required: true })}
${input({ name: "banner", label: "Banner line", hint: "As it appears at the top and bottom of each page.", value: v("banner"), errors: e })}
${textarea({ name: "controls", label: "Control markings", hint: "One per line.", value: v("controls"), errors: e, rows: 3 })}
<h2>Classification authority block</h2>
<p class="usa-hint">Needed when the guide itself is classified.</p>
${input({ name: "cab_classified_by", label: "Classified by", value: v("cab_classified_by"), errors: e })}
${input({ name: "cab_derived_from", label: "Derived from", value: v("cab_derived_from"), errors: e })}
${input({ name: "cab_reason", label: "Reason", value: v("cab_reason"), errors: e })}
${input({ name: "cab_declassify_on", label: "Declassify on", value: v("cab_declassify_on"), errors: e })}
<h2>Markings review</h2>
${choices({
  name: "review_status",
  label: "Has an authorized person reviewed these markings?",
  type: "radio",
  options: MARKING_REVIEW.map((s) => ({
    value: s,
    label: { not_started: "Not started", pending: "In progress", complete: "Complete" }[s],
  })),
  selected: [v("review_status")],
  errors: e,
})}
${input({ name: "reviewed_by", label: "Reviewed by", value: v("reviewed_by"), errors: e, autocomplete: "off" })}
${input({ name: "reviewed_on", label: "Reviewed on", hint: "YYYY-MM-DD", value: v("reviewed_on"), errors: e, width: "medium" })}
`,
  });
}

// ---- Sections ------------------------------------------------------------------

export function sectionsPage(view: GuideView, f: Form, errors: readonly FieldError[]): Safe {
  const v = (n: string) => f.get(n) ?? "";
  const e = errors;
  const idx = rows(f, "section_id");
  return formPage({
    title: "Sections",
    action: `/guides/${view.key}/sections`,
    errors,
    readonly: view.frozen,
    intro: html`<p>Sections group entries for display. Fill in a blank row to add one. Save to get more blank rows.</p>`,
    body: html`${idx.map(
      (
        i,
      ) => html`<fieldset class="usa-fieldset imprint-subgroup"><legend class="usa-legend">${v(`section_id_${i}`) ? `Section ${v(`section_id_${i}`)}` : "New section"}</legend>
${input({ name: `section_id_${i}`, label: "Section ID", value: v(`section_id_${i}`), errors: e, width: "medium" })}
${input({ name: `section_title_${i}`, label: "Title", value: v(`section_title_${i}`), errors: e })}
${input({ name: `section_portion_${i}`, label: "Portion marking", hint: "The marking of this section within the guide, for example (U).", value: v(`section_portion_${i}`), errors: e, width: "small" })}
${textarea({ name: `section_description_${i}`, label: "Description", value: v(`section_description_${i}`), errors: e, rows: 2 })}
${v(`section_id_${i}`) ? choices({ name: `section_remove_${i}`, label: "Remove", type: "checkbox", options: [{ value: "on", label: "Remove this section" }], selected: f.getAll(`section_remove_${i}`), errors: e }) : ""}
</fieldset>`,
    )}`,
  });
}

// ---- Entry editor ----------------------------------------------------------------

export function entryPage(
  view: GuideView,
  index: number | "new",
  f: Form,
  errors: readonly FieldError[],
  entryFindings: readonly Finding[],
): Safe {
  const v = (n: string) => f.get(n) ?? "";
  const e = errors;
  const base = `/guides/${view.key}`;
  const entries = arr(view.doc.entries).map(obj);
  const self = index === "new" ? "" : str(entries[index]?.entry_id);
  const others = entries.map((x) => str(x.entry_id)).filter((id) => id && id !== self);
  const sections = arr(view.doc.sections).map(obj);
  const mode = v("level_mode") || "single";
  const dk = v("declass_kind") || "none";
  const action = index === "new" ? `${base}/entries` : `${base}/entries/${index}`;
  const controlRows = rows(f, "control_marking");
  const sourceRows = rows(f, "source_citation");
  return formPage({
    title: index === "new" ? "Add an entry" : `Entry ${self || index + 1}`,
    action,
    errors,
    readonly: view.frozen,
    intro: entryFindings.length
      ? html`<div class="usa-alert usa-alert--warning imprint-entry-findings"><div class="usa-alert__body"><h2 class="usa-alert__heading">Checks for this entry</h2><ul class="usa-list">${entryFindings.map(
          (x) => html`<li>${x.message} <span class="imprint-code">${x.code}</span></li>`,
        )}</ul></div></div>`
      : undefined,
    body: html`
${input({ name: "entry_id", label: "Entry ID", hint: "A short, stable identifier, for example perf-range.", value: v("entry_id"), errors: e, width: "medium", required: true })}
${choices({
  name: "kind",
  label: "Kind of entry",
  type: "radio",
  options: [
    { value: "element", label: "Element", hint: "One precise item of information." },
    {
      value: "compilation",
      label: "Compilation",
      hint: "A combination of items that needs more protection than each alone.",
    },
  ],
  selected: [v("kind") || "element"],
  errors: e,
})}
${textarea({ name: "description", label: "What information does this entry cover?", hint: "Describe one precise item. Vague descriptions such as “program details” cannot be applied consistently.", value: v("description"), errors: e, rows: 4, required: true })}
${choices({
  name: "level_mode",
  label: "Level",
  type: "radio",
  options: [
    { value: "single", label: "One level" },
    { value: "range", label: "A range that depends on conditions" },
  ],
  selected: [mode],
  errors: e,
})}
<div class="imprint-subgroup">
<div data-show-when="level_mode=single">
${select({ name: "level", label: "Classification level (when one level)", options: levelOptions, value: v("level"), blank: "- Select -", errors: e })}
</div>
<div data-show-when="level_mode=range">
${select({ name: "range_lowest", label: "Lowest level (when a range)", options: levelOptions, value: v("range_lowest"), blank: "- Select -", errors: e })}
${select({ name: "range_highest", label: "Highest level (when a range)", options: levelOptions, value: v("range_highest"), blank: "- Select -", errors: e })}
${textarea({ name: "range_condition", label: "Conditions that decide the level (when a range)", hint: "For example: Unclassified when stated only as a general band; Confidential when stated within 10 MHz.", value: v("range_condition"), errors: e, rows: 3 })}
</div>
</div>
${textarea({ name: "condition_text", label: "Conditions", hint: "For a compilation: when does the combination apply? Written for people; Imprint does not evaluate it.", value: v("condition_text"), errors: e, rows: 3 })}
${
  others.length
    ? choices({
        name: "references",
        label: "Related entries",
        hint: "For a compilation, the entries it combines.",
        type: "checkbox",
        options: others.map((id) => ({ value: id, label: id })),
        selected: f.getAll("references"),
        errors: e,
      })
    : html`<input type="hidden" name="references" value="">`
}
${textarea({ name: "exceptions_text", label: "Exceptions", value: v("exceptions_text"), errors: e, rows: 2 })}
<h2>Reason</h2>
<p class="usa-hint">Required for classified entries. Do not add a reason to an unclassified entry just to fill the form.</p>
${choices({ name: "reason_categories", label: "E.O. 13526 section 1.4 categories", type: "checkbox", options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_NAMES[c] ?? c })), selected: f.getAll("reason_categories"), errors: e })}
${textarea({ name: "reason_explanation", label: "Why is this information classified?", hint: "A short, specific reason.", value: v("reason_explanation"), errors: e, rows: 3 })}
<h2>Declassification</h2>
${choices({
  name: "declass_kind",
  label: "Declassification instruction",
  hint: "Required for classified entries. Fill in the fields for the kind you choose.",
  type: "radio",
  options: [
    { value: "none", label: "None (unclassified entry)" },
    { value: "date", label: "On a date" },
    { value: "event", label: "When an event happens" },
    {
      value: "relative_to_record_creation",
      label: "A number of years after each record is created",
      hint: "Stays relative: Imprint never turns it into a date.",
    },
    {
      value: "exemption",
      label: "Exempt from automatic declassification",
      hint: "Choosing a code does not prove the exemption was approved.",
    },
  ],
  selected: [dk],
  errors: e,
})}
<div class="imprint-subgroup">
<div data-show-when="declass_kind=date">
${input({ name: "declass_date", label: "Date (when on a date)", hint: "YYYY-MM-DD", value: v("declass_date"), errors: e, width: "medium" })}
</div>
<div data-show-when="declass_kind=event">
${textarea({ name: "declass_event", label: "Event (when an event happens)", hint: "Something that can be checked independently.", value: v("declass_event"), errors: e, rows: 2 })}
</div>
<div data-show-when="declass_kind=relative_to_record_creation">
${input({ name: "declass_years", label: "Years after the record is created", value: v("declass_years"), errors: e, width: "small", inputmode: "numeric" })}
</div>
<div data-show-when="declass_kind=exemption">
${input({ name: "exempt_code", label: "Exemption code (when exempt)", hint: "For example 25X1, 50X1-HUM or 75X3.", value: v("exempt_code"), errors: e, width: "small" })}
${input({ name: "exempt_until_date", label: "Exempt until date", hint: "YYYY-MM-DD, optional.", value: v("exempt_until_date"), errors: e, width: "medium" })}
${textarea({ name: "exempt_until_event", label: "Exempt until event", hint: "Optional.", value: v("exempt_until_event"), errors: e, rows: 2 })}
${evidenceFields("evidence", "Exemption authority evidence", f, e)}
</div>
</div>
<h2>Controls</h2>
<p class="usa-hint">Dissemination, CUI or handling markings that apply to the information. Fill in a blank row to add one.</p>
${controlRows.map(
  (
    i,
  ) => html`<fieldset class="usa-fieldset imprint-subgroup"><legend class="usa-legend">Control ${i + 1}</legend>
${input({ name: `control_marking_${i}`, label: "Marking", value: v(`control_marking_${i}`), errors: e, width: "medium" })}
${select({ name: `control_kind_${i}`, label: "Kind", options: CONTROL_KINDS.map((k) => ({ value: k, label: k })), value: v(`control_kind_${i}`) || "dissemination", errors: e })}
${input({ name: `control_note_${i}`, label: "Note", value: v(`control_note_${i}`), errors: e })}
${v(`control_marking_${i}`) ? choices({ name: `control_remove_${i}`, label: "Remove", type: "checkbox", options: [{ value: "on", label: "Remove this control" }], selected: f.getAll(`control_remove_${i}`), errors: e }) : ""}
</fieldset>`,
)}
<h2>Sources</h2>
${sourceRows.map(
  (
    i,
  ) => html`<fieldset class="usa-fieldset imprint-subgroup"><legend class="usa-legend">Source ${i + 1}</legend>
${input({ name: `source_citation_${i}`, label: "Citation", value: v(`source_citation_${i}`), errors: e })}
${input({ name: `source_uri_${i}`, label: "Address (URI)", value: v(`source_uri_${i}`), errors: e })}
${v(`source_citation_${i}`) ? choices({ name: `source_remove_${i}`, label: "Remove", type: "checkbox", options: [{ value: "on", label: "Remove this source" }], selected: f.getAll(`source_remove_${i}`), errors: e }) : ""}
</fieldset>`,
)}
<h2>Placement in the guide</h2>
${select({ name: "section_id", label: "Section", options: sections.map((s) => ({ value: str(s.section_id), label: `${str(s.section_id)}: ${str(s.title)}` })), value: v("section_id"), blank: "- No section -", errors: e })}
${input({ name: "portion_marking", label: "Portion marking", hint: "The marking of this row within the guide document, for example (U). Not the level of the information.", value: v("portion_marking"), errors: e, width: "small" })}
${select({
  name: "regime",
  label: "Regime",
  hint: "Atomic Energy Act information is not supported in OpenSCG 0.1 and blocks freezing.",
  options: [
    { value: "cnsi", label: "Classified national security information (E.O. 13526)" },
    { value: "aea", label: "Atomic Energy Act information (not supported)" },
  ],
  value: v("regime") || "cnsi",
  errors: e,
})}
<h2>Explanatory statements</h2>
<p class="usa-hint">Optional. Recommended by the ISOO handbook, not required by law.</p>
${textarea({ name: "statement_value", label: "Value statement", value: v("statement_value"), errors: e, rows: 2 })}
${textarea({ name: "statement_damage", label: "Damage statement", value: v("statement_damage"), errors: e, rows: 2 })}
${textarea({ name: "statement_unclassified", label: "Unclassified statement", value: v("statement_unclassified"), errors: e, rows: 2 })}
${textarea({ name: "notes", label: "Notes", value: v("notes"), errors: e, rows: 2 })}
`,
    submitLabel: index === "new" ? "Add entry" : "Save entry",
    extra:
      index !== "new" && !view.frozen
        ? html`<form method="post" action="${base}/entries/${index}/delete" class="usa-form imprint-delete"><input type="hidden" name="entry_id" value="${self}">${submit("Delete this entry", { secondary: true })}</form>`
        : undefined,
  });
}

// ---- Freeze -----------------------------------------------------------------------

export function freezePage(view: GuideView, digest: { alg: string; value: string } | null): Safe {
  const base = `/guides/${view.key}`;
  const d = view.doc;
  return html`
<h1>Freeze revision ${str(d.revision_id)}</h1>
<p>Freezing makes this revision a <strong>candidate</strong> for approval. Its content will never change again. Any later change becomes a new revision, and earlier frozen revisions stay exactly as they are.</p>
<p>Freezing is not approval. Approval is a separate, personal act by the original classification authority.</p>
${
  view.frozen
    ? html`<div class="usa-alert usa-alert--info"><div class="usa-alert__body"><p class="usa-alert__text">Revision ${str(d.revision_id)} is already frozen. <a href="${base}/revisions/${str(d.revision_id)}">See the frozen revision</a>.</p></div></div>`
    : view.approvalReady && digest
      ? html`<div class="usa-summary-box" role="region" aria-labelledby="freeze-summary">
  <div class="usa-summary-box__body"><h2 class="usa-summary-box__heading" id="freeze-summary">What will be frozen</h2>
  <ul class="usa-list">
    <li>Guide: ${str(d.title)}</li>
    <li>Guide ID: <span class="imprint-mono">${str(d.guide_id)}</span></li>
    <li>Revision: ${str(d.revision_id)}</li>
    <li>Payload digest (${digest.alg}): <span class="imprint-mono imprint-wrap">${digest.value}</span></li>
  </ul>
  <p>The approval statement the signer will be asked to approve:</p>
  <blockquote class="imprint-statement">${approvalText({ guide_id: str(d.guide_id), revision_id: str(d.revision_id), title: str(d.title) }, digest as never)}</blockquote>
  </div></div>
<form method="post" action="${base}/freeze" class="usa-form">${submit("Freeze this revision")}</form>`
      : html`<div class="usa-alert usa-alert--error"><div class="usa-alert__body"><p class="usa-alert__text">This draft is not ready to freeze. <a href="${base}">Return to the guide</a> to see what needs attention.</p></div></div>`
}`;
}

// ---- Revision -------------------------------------------------------------------------

export function revisionPage(view: GuideView, record: FreezeRecord, doc: Doc): Safe {
  const base = `/guides/${view.key}`;
  return html`
<h1>Revision ${record.revision_id}</h1>
<div class="usa-summary-box" role="region" aria-labelledby="rev-summary"><div class="usa-summary-box__body">
<h2 class="usa-summary-box__heading" id="rev-summary">Identity</h2>
<ul class="usa-list">
  <li>Guide: ${str(doc.title)}</li>
  <li>Guide ID: <span class="imprint-mono">${str(doc.guide_id)}</span></li>
  <li>Payload digest (${record.payload_digest.alg}): <span class="imprint-mono imprint-wrap">${record.payload_digest.value}</span></li>
  <li>Frozen: ${record.frozen_at}</li>
</ul></div></div>
<h2>Status</h2>
<ul class="usa-list">
  <li><strong>Frozen:</strong> yes. This content cannot change.</li>
  <li><strong>Signed:</strong> not yet.</li>
  <li><strong>Authority:</strong> not verified.</li>
  <li><strong>Issued:</strong> Imprint does not issue guides. Issuance and distribution are acts of your organization.</li>
</ul>
<h2>Approval statement</h2>
<blockquote class="imprint-statement">${approvalText({ guide_id: str(doc.guide_id), revision_id: record.revision_id, title: str(doc.title) }, record.payload_digest)}</blockquote>
<h2>Download</h2>
<p><a href="${base}/revisions/${record.revision_id}/guide.json" download>Frozen guide (OpenSCG JSON, canonical form)</a></p>`;
}

export function messagePage(title: string, message: string, back?: string): Safe {
  return html`<h1>${title}</h1><p>${message}</p>${back ? html`<p><a href="${back}">Go back</a></p>` : ""}`;
}
