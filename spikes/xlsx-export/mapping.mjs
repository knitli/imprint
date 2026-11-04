// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike SP-05: a documented XLSX mapping for OpenSCG 0.1 guides.
// Synthetic data only. This is spike code, not product code.
//
// One declarative table (SHEETS below) drives both directions:
//   writeWorkbook(guide)  -> xlsx bytes
//   readWorkbook(bytes)   -> the guide as far as the workbook can carry it
// MAPPING.md is the human-readable version of the same table.

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { payloadDigest, SPEC_VERSION } from "@knitli/openscg";

export const MAPPING_VERSION = "imprint-xlsx-spike-1";

export const LIMITATIONS =
  "GENERIC EXPORT — NOT A DTIC SUBMISSION. This workbook is a documented mapping of an OpenSCG guide, " +
  "produced by an experimental Imprint spike. It has not been checked against any DoD or DTIC template and must not " +
  "be described as meeting DoDM 5200.45 or any submission format. The OpenSCG JSON file is the authoritative copy; " +
  "see the loss report for what this workbook does not carry. The digest shown identifies the signed JSON payload; " +
  "it does not prove this workbook matches it.";

// ---------------------------------------------------------------------------
// Pointer helpers (RFC 6901, objects only plus numeric array indices)
// ---------------------------------------------------------------------------
const tokens = (p) => (p === "" ? [] : p.slice(1).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~")));
export function getAt(obj, p) {
  let cur = obj;
  for (const t of tokens(p)) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}
function setAt(obj, p, value) {
  const ts = tokens(p);
  let cur = obj;
  ts.forEach((t, i) => {
    if (i === ts.length - 1) cur[t] = value;
    else cur = cur[t] ??= {};
  });
}

// ---------------------------------------------------------------------------
// Value encodings. Everything lands in a cell as a STRING (never a formula,
// never an Excel date), so nothing is evaluated or shifted by time zone.
// ---------------------------------------------------------------------------
const enc = {
  text: { out: (v) => v, in: (s) => s },
  int: { out: (v) => String(v), in: (s) => Number.parseInt(s, 10) },
  bool: { out: (v) => (v ? "true" : "false"), in: (s) => s === "true" },
  // One item per line. Safe for ids and categories; lossy if an item itself
  // contains a line break (the round-trip test detects that).
  list: { out: (v) => v.join("\n"), in: (s) => s.split("\n") },
};

// ---------------------------------------------------------------------------
// The mapping. "About" is a key/value sheet; the others are one row per item.
// display: true marks a column written for people and ignored on read.
// ---------------------------------------------------------------------------
const ABOUT_FIELDS = [
  ["Schema version", "/schema_version"],
  ["Profile", "/profile"],
  ["Synthetic", "/synthetic", "bool"],
  ["Guide ID", "/guide_id"],
  ["Revision ID", "/revision_id"],
  ["Title", "/title"],
  ["Subject", "/subject"],
  ["Scope", "/scope"],
  ["Issuing organization", "/issuing_organization/name"],
  ["Issuing organization identifier", "/issuing_organization/identifier"],
  ["Point of contact: name", "/point_of_contact/name"],
  ["Point of contact: position", "/point_of_contact/position"],
  ["Point of contact: organization", "/point_of_contact/organization"],
  ["Point of contact: email", "/point_of_contact/email"],
  ["Point of contact: phone", "/point_of_contact/phone"],
  ["OCA: name", "/oca/name"],
  ["OCA: position", "/oca/position"],
  ["OCA: personal identifier", "/oca/personal_identifier"],
  ["OCA: highest level (claimed)", "/oca/highest_level"],
  ["Date issued", "/dates/issued"],
  ["Date last reviewed", "/dates/last_reviewed"],
  ["Date effective", "/dates/effective"],
  ["Next review due", "/dates/next_review_due"],
  ["Lifecycle state (recorded)", "/lifecycle/state"],
  ["Lifecycle note", "/lifecycle/note"],
  ["Document classification", "/document_markings/classification"],
  ["Document banner", "/document_markings/banner"],
  ["Document controls (one per line)", "/document_markings/controls", "list"],
  ["Classified by", "/document_markings/classification_authority_block/classified_by"],
  ["Derived from", "/document_markings/classification_authority_block/derived_from"],
  ["Classification reason (document)", "/document_markings/classification_authority_block/reason"],
  ["Declassify on (document)", "/document_markings/classification_authority_block/declassify_on"],
  ["Markings review status", "/document_markings/review/status"],
  ["Markings reviewed by", "/document_markings/review/reviewed_by"],
  ["Markings reviewed on", "/document_markings/review/reviewed_on"],
  ["Introduction", "/introduction"],
  ["Claimed signer: name", "/authority/claimed_signer/name"],
  ["Claimed signer: position", "/authority/claimed_signer/position"],
  ["Claimed signer: personal identifier", "/authority/claimed_signer/personal_identifier"],
  ["Claimed delegation: highest level", "/authority/claimed_delegation/highest_level"],
  ["Claimed delegation: program", "/authority/claimed_delegation/program"],
  ["Claimed delegation evidence: kind", "/authority/claimed_delegation/evidence/kind"],
  ["Claimed delegation evidence: reference", "/authority/claimed_delegation/evidence/reference"],
  ["Claimed delegation evidence: date", "/authority/claimed_delegation/evidence/date"],
  ["Claimed delegation evidence: URI", "/authority/claimed_delegation/evidence/uri"],
  ["Authority review status", "/review/status"],
  ["Authority reviewed by", "/review/reviewed_by"],
  ["Authority reviewed on", "/review/reviewed_on"],
  ["Authority review notes", "/review/notes"],
];

const ENTRY_COLUMNS = [
  { h: "Guide order", p: "#order", t: "int" },
  { h: "Entry ID", p: "/entry_id" },
  { h: "Section ID", p: "/section_id" },
  { h: "Portion marking (of this row)", p: "/portion_marking" },
  { h: "Information described", p: "/description" },
  { h: "Level", display: (e) => e.level ?? (e.level_range ? `${e.level_range.lowest} to ${e.level_range.highest} (see conditions)` : "") },
  { h: "Level (single)", p: "/level" },
  { h: "Level range: lowest", p: "/level_range/lowest" },
  { h: "Level range: highest", p: "/level_range/highest" },
  { h: "Level range: conditions", p: "/level_range/condition_text" },
  { h: "Regime", p: "/regime" },
  { h: "Conditions", p: "/condition_text" },
  { h: "Exceptions", p: "/exceptions_text" },
  { h: "Referenced entries (one per line)", p: "/references", t: "list" },
  { h: "Controls", display: (e) => (e.controls ?? []).map((c) => `${c.marking} [${c.kind}]`).join("\n") },
  { h: "Reason: §1.4 categories (one per line)", p: "/reason/categories", t: "list" },
  { h: "Reason: explanation", p: "/reason/explanation" },
  { h: "Declassification", display: (e) => describeDeclass(e.declassification) },
  { h: "Declassification: kind", p: "/declassification/kind" },
  { h: "Declassify on date", p: "/declassification/date" },
  { h: "Declassify on event", p: "/declassification/event_text" },
  { h: "Years after record creation", p: "/declassification/years", t: "int" },
  { h: "Exemption code (claimed)", p: "/declassification/code" },
  { h: "Exemption until date", p: "/declassification/until_date" },
  { h: "Exemption until event", p: "/declassification/until_event_text" },
  { h: "Exemption authority: kind", p: "/declassification/authority/kind" },
  { h: "Exemption authority: reference", p: "/declassification/authority/reference" },
  { h: "Exemption authority: date", p: "/declassification/authority/date" },
  { h: "Exemption authority: URI", p: "/declassification/authority/uri" },
  { h: "Value statement", p: "/statements/value" },
  { h: "Damage statement", p: "/statements/damage" },
  { h: "Unclassified statement", p: "/statements/unclassified" },
  { h: "Notes", p: "/notes" },
];

function describeDeclass(d) {
  if (!d) return "";
  switch (d.kind) {
    case "date":
      return `On ${d.date}`;
    case "event":
      return `When: ${d.event_text}`;
    case "relative_to_record_creation":
      // Stays relative. Never converted to a calendar date (spec 4.6).
      return `${d.years} years after the record containing the information was created`;
    case "exemption":
      return `Exemption ${d.code} (claimed${d.authority ? "; evidence recorded, not verified" : "; no evidence recorded"})`;
    default:
      return "";
  }
}

const SHEETS = [
  {
    name: "Entries",
    title: "Classification guidance: individual elements",
    rows: (g) => (g.entries ?? []).map((e, i) => ({ ...e, "#order": i + 1 })).filter((e) => e.kind === "element"),
    columns: ENTRY_COLUMNS,
    fixed: { kind: "element" },
  },
  {
    name: "Compilation",
    title: "Classification guidance: compilations (combinations of information)",
    rows: (g) => (g.entries ?? []).map((e, i) => ({ ...e, "#order": i + 1 })).filter((e) => e.kind === "compilation"),
    columns: ENTRY_COLUMNS.map((c) => (c.p === "/references" ? { ...c, h: "Constituent entries (one per line)" } : c)),
    fixed: { kind: "compilation" },
  },
  {
    name: "Controls",
    title: "Controls and handling markings that apply to described information",
    rows: (g) => (g.entries ?? []).flatMap((e) => (e.controls ?? []).map((c) => ({ ...c, "#entry": e.entry_id }))),
    columns: [
      { h: "Entry ID", p: "#entry" },
      { h: "Marking", p: "/marking" },
      { h: "Kind", p: "/kind" },
      { h: "Note", p: "/note" },
    ],
  },
  {
    name: "Sources",
    title: "Sources of the guidance",
    rows: (g) => (g.entries ?? []).flatMap((e) => (e.sources ?? []).map((s) => ({ ...s, "#entry": e.entry_id }))),
    columns: [
      { h: "Entry ID", p: "#entry" },
      { h: "Citation", p: "/citation" },
      { h: "URI", p: "/uri" },
    ],
  },
  {
    name: "Sections",
    title: "Sections of the guide",
    rows: (g) => g.sections ?? [],
    columns: [
      { h: "Section ID", p: "/section_id" },
      { h: "Title", p: "/title" },
      { h: "Portion marking", p: "/portion_marking" },
      { h: "Description", p: "/description" },
    ],
  },
  {
    name: "Links",
    title: "Related guides, earlier revisions, recorded events and review evidence",
    rows: (g) => [
      ...(g.lifecycle?.supersedes ?? []).map((x) => ({ ...x, "#rel": "supersedes" })),
      ...(g.lifecycle?.superseded_by ?? []).map((x) => ({ ...x, "#rel": "superseded_by" })),
      ...(g.history?.previous_revisions ?? []).map((x) => ({ ...x, "#rel": "previous_revision" })),
      ...(g.history?.events ?? []).map((x) => ({ ...x, "#rel": "event" })),
      ...(g.review?.evidence ?? []).map((x) => ({ ...x, "#rel": "review_evidence" })),
    ],
    columns: [
      { h: "Relation", p: "#rel" },
      { h: "Guide ID", p: "/guide_id" },
      { h: "Revision ID", p: "/revision_id" },
      { h: "Title", p: "/title" },
      { h: "Kind", p: "/kind" },
      { h: "Reference", p: "/reference" },
      { h: "Date", p: "/date" },
      { h: "URI", p: "/uri" },
      { h: "Payload digest (SHA-256)", p: "/payload_digest/value" },
      { h: "Note", p: "/note" },
    ],
  },
];

// Pointers in the guide that this mapping deliberately does not carry.
export const NOT_MAPPED = {
  "/extensions": "Extension data can be any JSON and may be must-understand. It stays in the JSON only; the loss report lists it.",
  "/entries[]/extensions": "Same as guide-level extensions.",
  "/attestations": "Signatures are binary and travel as the detached attestation next to the workbook, not inside it.",
};

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
const TEXT = { numFmt: "@", alignment: { wrapText: true, vertical: "top" } };

function putText(cell, s) {
  // Always a plain string value: ExcelJS writes it as a shared string (t="s"),
  // which spreadsheet programs display and never evaluate. numFmt "@" (Text)
  // keeps it a string if someone later edits the cell.
  cell.value = oxmlEscape(s);
  cell.style = TEXT;
}

// OOXML strings cannot carry some characters directly. ExcelJS 4.4.0 silently
// drops C0 control characters, writes CR raw (XML parsers turn it into LF),
// and on read decodes "_xHHHH_" without encoding it on write, so a literal
// "_x0041_" in a description would come back as "A". Escape the OOXML way
// (ST_Xstring): "_xHHHH_" for the character, "_x005F_" for a literal "_" that
// would otherwise start an escape. Spreadsheet programs decode these the same way.
export function oxmlEscape(s) {
  return String(s)
    .replace(/_(?=x[0-9A-Fa-f]{4}_)/g, "_x005F_")
    .replace(/[\x00-\x08\x0B\x0C\x0D\x0E-\x1F\x7F]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

export async function writeWorkbook(guide, { approved = false, fixedTime } = {}) {
  const digest = await payloadDigest(guide);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Imprint spike SP-05";
  const t = fixedTime ?? new Date();
  wb.created = t;
  wb.modified = t;

  const banner = guide.document_markings?.banner ?? guide.document_markings?.classification ?? "";
  const labels = [guide.synthetic ? "SYNTHETIC" : null, approved ? null : "DRAFT / NOT APPROVED"].filter(Boolean).join(" — ");
  const header = `&C&B${xmlSafeHeader(banner)}`;
  const footer = `&L${xmlSafeHeader(labels)}&C${xmlSafeHeader(banner)}&RPage &P of &N`;

  const addSheet = (name) => {
    const ws = wb.addWorksheet(name, {
      headerFooter: { oddHeader: header, oddFooter: footer },
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    // Rows 1-3: banner, labels, identity. Repeated on every sheet.
    putText(ws.getCell("A1"), banner);
    ws.getCell("A1").font = { bold: true };
    putText(ws.getCell("A2"), labels);
    ws.getCell("A2").font = { bold: true, color: { argb: "FFB00020" } };
    putText(ws.getCell("A3"), `Guide ${guide.guide_id} · revision ${guide.revision_id} · payload digest ${digest.alg}:${digest.value}`);
    return ws;
  };

  // About
  const about = addSheet("About");
  putText(about.getCell("A4"), LIMITATIONS);
  about.mergeCells("A4:C4");
  about.getRow(4).height = 75;
  const aboutHeader = ["Field", "Value", "JSON pointer"];
  about.getRow(6).values = aboutHeader;
  about.getRow(6).font = { bold: true };
  const meta = [
    ["Payload digest algorithm", digest.alg, "(computed)"],
    ["Payload digest", digest.value, "(computed)"],
    ["OpenSCG specification implemented", SPEC_VERSION, "(computed)"],
    ["Workbook mapping", MAPPING_VERSION, "(computed)"],
  ];
  let r = 7;
  // Spec 10.1: a rendition SHOULD carry a loss report. List what this mapping
  // never carries, so a reader of the workbook alone can see it.
  const notCarried = [
    ...(guide.extensions ? Object.keys(guide.extensions).map((k) => `/extensions/${k}${guide.extensions[k].must_understand ? " (must-understand)" : ""}`) : []),
    ...(guide.entries ?? []).flatMap((e, i) => Object.keys(e.extensions ?? {}).map((k) => `/entries/${i}/extensions/${k}${e.extensions[k].must_understand ? " (must-understand)" : ""}`)),
    ...(guide.attestations?.length ? [`/attestations (${guide.attestations.length}; supplied as a separate file)`] : []),
  ];
  meta.push(["Not carried in this workbook", notCarried.length ? notCarried.join("\n") : "Nothing (see the loss report)", "(loss report)"]);
  for (const [label, value, ptr] of meta) {
    putText(about.getCell(r, 1), label);
    putText(about.getCell(r, 2), value);
    putText(about.getCell(r, 3), ptr);
    r++;
  }
  for (const [label, ptr, type = "text"] of ABOUT_FIELDS) {
    const v = getAt(guide, ptr);
    putText(about.getCell(r, 1), label);
    if (v !== undefined) putText(about.getCell(r, 2), enc[type].out(v));
    putText(about.getCell(r, 3), ptr);
    r++;
  }
  about.columns = [{ width: 38 }, { width: 90 }, { width: 50 }];
  about.views = [{ state: "frozen", ySplit: 6 }];

  // Row sheets
  for (const sh of SHEETS) {
    const ws = addSheet(sh.name);
    putText(ws.getCell("A4"), sh.title);
    ws.getCell("A4").font = { bold: true, size: 13 };
    const hr = ws.getRow(6);
    sh.columns.forEach((c, i) => {
      putText(hr.getCell(i + 1), c.h);
    });
    hr.font = { bold: true };
    sh.rows(guide).forEach((item, ri) => {
      const row = ws.getRow(7 + ri);
      sh.columns.forEach((c, ci) => {
        let v;
        if (c.display) v = c.display(item) || undefined;
        else v = c.p.startsWith("#") ? item[c.p] : getAt(item, c.p);
        if (v === undefined || v === null) return;
        putText(row.getCell(ci + 1), c.display ? v : enc[c.t ?? "text"].out(v));
      });
    });
    ws.columns = sh.columns.map((c) => ({ width: /Information|explanation|Conditions|statement|Notes|Description|event/i.test(c.h) ? 60 : 22 }));
    ws.views = [{ state: "frozen", ySplit: 6, xSplit: sh.name === "Entries" || sh.name === "Compilation" ? 2 : 0 }];
    if (ws.rowCount >= 6) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: sh.columns.length } };
  }

  // Mapping sheet: the workbook documents its own layout.
  const map = addSheet("Mapping");
  putText(map.getCell("A4"), "How each column maps to the OpenSCG JSON. Columns marked display-only are written for people and not read back.");
  map.getRow(6).values = ["Sheet", "Column", "JSON pointer (relative to the row's item)", "Encoding"];
  map.getRow(6).font = { bold: true };
  let mr = 7;
  for (const sh of SHEETS)
    for (const c of sh.columns) {
      [sh.name, c.h, c.display ? "(display-only)" : c.p, c.display ? "" : (c.t ?? "text")].forEach((v, i) => putText(map.getCell(mr, i + 1), v));
      mr++;
    }
  map.columns = [{ width: 14 }, { width: 40 }, { width: 50 }, { width: 10 }];

  return normalizeZip(await wb.xlsx.writeBuffer(), t);
}

// ExcelJS stamps every zip entry with the current time, so two exports of the
// same revision differ byte for byte. Repack with one fixed timestamp (the
// export time we were given) so the bytes depend only on the input.
async function normalizeZip(buf, date) {
  const src = await JSZip.loadAsync(buf);
  const out = new JSZip();
  for (const name of Object.keys(src.files).sort()) {
    const f = src.files[name];
    if (f.dir) continue;
    out.file(name, await f.async("uint8array"), { date, createFolders: false });
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "UNIX" });
}

// Header/footer codes use "&" as an escape; double it in user text.
const xmlSafeHeader = (s) => String(s).replace(/&/g, "&&");

// ---------------------------------------------------------------------------
// Read back
// ---------------------------------------------------------------------------
const cellText = (cell) => {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.richText) return v.richText.map((x) => x.text).join("");
  return String(v);
};

export async function readWorkbook(bytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const guide = {};

  const about = wb.getWorksheet("About");
  const byPtr = new Map(ABOUT_FIELDS.map(([, p, t = "text"]) => [p, t]));
  about.eachRow((row, n) => {
    if (n <= 6) return;
    const ptr = cellText(row.getCell(3));
    const val = cellText(row.getCell(2));
    if (!byPtr.has(ptr) || val === undefined) return;
    setAt(guide, ptr, enc[byPtr.get(ptr)].in(val));
  });

  const readRows = (sh) => {
    const ws = wb.getWorksheet(sh.name);
    const headers = [];
    ws.getRow(6).eachCell((c, i) => (headers[i] = cellText(c)));
    const out = [];
    ws.eachRow((row, n) => {
      if (n <= 6) return;
      const item = { ...(sh.fixed ?? {}) };
      const extra = {};
      headers.forEach((h, i) => {
        const col = sh.columns.find((c) => c.h === h);
        if (!col || col.display) return;
        const s = cellText(row.getCell(i));
        if (s === undefined) return;
        const v = enc[col.t ?? "text"].in(s);
        if (col.p.startsWith("#")) extra[col.p] = v;
        else setAt(item, col.p, v);
      });
      out.push({ item, extra });
    });
    return out;
  };

  const rowsOf = Object.fromEntries(SHEETS.map((s) => [s.name, readRows(s)]));

  const entries = [...rowsOf.Entries, ...rowsOf.Compilation]
    .sort((a, b) => a.extra["#order"] - b.extra["#order"])
    .map(({ item }) => item);
  const byId = new Map(entries.map((e) => [e.entry_id, e]));
  for (const { item, extra } of rowsOf.Controls) (byId.get(extra["#entry"]).controls ??= []).push(item);
  for (const { item, extra } of rowsOf.Sources) (byId.get(extra["#entry"]).sources ??= []).push(item);
  // Put keys back in schema order so a diff reads cleanly (order is not significant in JSON).
  guide.entries = entries;
  if (rowsOf.Sections.length) guide.sections = rowsOf.Sections.map((r) => r.item);

  for (const { item, extra } of rowsOf.Links) {
    const rel = extra["#rel"];
    if (rel === "supersedes" || rel === "superseded_by") ((guide.lifecycle ??= {})[rel] ??= []).push(item);
    else if (rel === "previous_revision") {
      if (item.payload_digest) item.payload_digest = { alg: "sha-256", ...item.payload_digest };
      ((guide.history ??= {}).previous_revisions ??= []).push(item);
    } else if (rel === "event") ((guide.history ??= {}).events ??= []).push(item);
    else if (rel === "review_evidence") ((guide.review ??= {}).evidence ??= []).push(item);
  }
  return guide;
}

export { SHEETS, ABOUT_FIELDS };
