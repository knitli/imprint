// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike SP-05 driver. Synthetic data only.
//  1. Export each fixture to out/<name>.xlsx through mapping.mjs.
//  2. Read each workbook back and compare with the source, field by field.
//  3. Write a coverage matrix (every schema field) and a loss report.
//  4. Check formula-injection handling in the raw sheet XML, and with LibreOffice.
//  5. Check whether output bytes are deterministic.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compareForLoss, parseStrict, validateStructure } from "@knitli/openscg";
import JSZip from "jszip"; // transitive dependency of exceljs; used here only to inspect the zip
import { NOT_MAPPED, readWorkbook, writeWorkbook } from "./mapping.mjs";

const require = createRequire(import.meta.url);
const pkgRoot = dirname(require.resolve("@knitli/openscg/package.json"));
const OUT = "out";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const FIXTURES = {
  "synthetic-lantern": join(pkgRoot, "examples/synthetic-lantern.json"),
  "requirements-compilation": join(pkgRoot, "examples/requirements-compilation.json"),
  "synthetic-everything": "fixtures/synthetic-everything.json",
  "synthetic-injection": "fixtures/synthetic-injection.json",
};
const FIXED_TIME = new Date("2026-11-04T00:00:00Z");
const sha = (b) => createHash("sha256").update(b).digest("hex");

// ---------------------------------------------------------------------------
// Leaf flattening: pointer -> primitive value
// ---------------------------------------------------------------------------
function leaves(v, p = "", out = new Map()) {
  if (v !== null && typeof v === "object") {
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
    if (keys.length === 0) out.set(p, JSON.stringify(v));
    for (const k of keys) leaves(v[k], `${p}/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
  } else out.set(p, v);
  return out;
}
// /entries/3/reason/categories/0 -> /entries[]/reason/categories[] ; extension keys -> *
function schemaPath(ptr) {
  const ts = ptr.split("/").slice(1);
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (/^\d+$/.test(t)) out[out.length - 1] += "[]";
    else if (out.at(-1)?.endsWith("extensions") && i > 0) {
      out.push("*");
      // everything inside extension data is one opaque value
      if (ts[i + 1] === "data") {
        out.push("data");
        break;
      }
    } else out.push(t);
  }
  return `/${out.join("/")}`;
}

// ---------------------------------------------------------------------------
// Schema walk: every field path in guide.schema.json
// ---------------------------------------------------------------------------
function schemaFields() {
  const s = JSON.parse(readFileSync(join(pkgRoot, "schema/0.1/guide.schema.json"), "utf8"));
  const defs = s.$defs;
  const out = new Map(); // path -> { required }
  const walk = (n, p, seen) => {
    if (!n) return;
    if (n.$ref) {
      const k = n.$ref.split("/").pop();
      if (seen.has(k)) return;
      return walk(defs[k], p, new Set([...seen, k]));
    }
    for (const c of ["oneOf", "anyOf", "allOf"]) n[c]?.forEach((x) => walk(x, p, seen));
    for (const [k, v] of Object.entries(n.properties ?? {})) {
      const q = `${p}/${k}`;
      const r = resolve(v, defs);
      const isLeafish = !r.properties && !r.items?.properties && !r.additionalProperties?.properties && !r.oneOf;
      if (!out.has(q)) out.set(q, { leaf: isLeafish, required: (n.required ?? []).includes(k) });
      walk(v, q, seen);
    }
    if (n.items) walk(n.items, `${p}[]`, seen);
    if (n.additionalProperties && typeof n.additionalProperties === "object") walk(n.additionalProperties, `${p}/*`, seen);
  };
  walk(s, "", new Set());
  return out;
}
function resolve(n, defs) {
  while (n?.$ref) n = defs[n.$ref.split("/").pop()];
  if (n?.items?.$ref) return { ...n, items: resolve(n.items, defs) };
  return n ?? {};
}

// ---------------------------------------------------------------------------
// 1-2. Export, read back, compare
// ---------------------------------------------------------------------------
const results = {};
const observed = new Map(); // schema path -> { total, kept, examples: [] }
for (const [name, file] of Object.entries(FIXTURES)) {
  const guide = parseStrict(readFileSync(file));
  if (validateStructure(guide).length) throw new Error(`${name} is not structurally valid`);
  const bytes = await writeWorkbook(guide, { fixedTime: FIXED_TIME });
  writeFileSync(join(OUT, `${name}.xlsx`), bytes);
  const back = await readWorkbook(bytes);
  writeFileSync(join(OUT, `${name}.roundtrip.json`), `${JSON.stringify(back, null, 2)}\n`);
  const loss = compareForLoss(guide, back);
  const src = leaves(guide);
  const got = leaves(back);
  // Additions: values the workbook invented that were not in the source.
  const added = [...got.keys()].filter((k) => !src.has(k));
  for (const [ptr, v] of src) {
    let sp = schemaPath(ptr);
    if (sp.endsWith("[]") && !sp.includes("/*/")) sp = sp.slice(0, -2); // primitive array items count toward the array field
    const o = observed.get(sp) ?? { total: 0, kept: 0, examples: [] };
    o.total++;
    if (got.has(ptr) && got.get(ptr) === v) o.kept++;
    else if (o.examples.length < 3) o.examples.push({ fixture: name, pointer: ptr, before: v, after: got.get(ptr) });
    observed.set(sp, o);
  }
  results[name] = {
    sha256: sha(bytes),
    bytes: bytes.length,
    roundtrip_structure_findings: validateStructure(back).length,
    loss,
    added,
  };
}

// ---------------------------------------------------------------------------
// 3. Coverage matrix and loss report
// ---------------------------------------------------------------------------
const fields = schemaFields();
const notMappedReason = (p) => {
  for (const [k, why] of Object.entries(NOT_MAPPED)) if (p === k || p.startsWith(`${k}/`) || p.startsWith(`${k}[]`)) return why;
  return null;
};
const rows = [];
for (const [p, meta] of fields) {
  if (!meta.leaf) continue; // objects/containers are covered through their leaves
  const why = notMappedReason(p);
  const o = observed.get(p);
  let status;
  let note = "";
  if (why) {
    status = "not mapped";
    note = why;
  } else if (!o) {
    status = "mapped (not exercised by any fixture)";
  } else if (o.kept === o.total) status = "mapped";
  else if (o.kept === 0) {
    status = "not mapped";
    note = `lost in ${o.total - o.kept}/${o.total} values`;
  } else {
    status = "partially";
    note = `${o.kept}/${o.total} values survived; e.g. ${o.examples.map((e) => `${e.fixture} ${e.pointer}: ${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}`).join("; ")}`;
  }
  rows.push({ field: p, required: meta.required, status, tested: o?.total ?? 0, note });
}
// Anything observed but missing from the schema walk (should be none).
for (const p of observed.keys()) if (!fields.has(p) && !p.includes("/*/data")) rows.push({ field: p, required: false, status: "?", tested: observed.get(p).total, note: "not found in schema walk" });

const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const md = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
writeFileSync(
  join(OUT, "coverage.md"),
  [
    "# Coverage matrix (generated by run.mjs)",
    "",
    "Every leaf field in OpenSCG 0.1 `guide.schema.json`, and whether the SP-05 workbook mapping carries it.",
    "Status comes from the round-trip test, not from the mapping's own claims: a field is **mapped** only if every value of it in every fixture came back unchanged.",
    "",
    `Totals: ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}`,
    "",
    "| Field | Required | Status | Values tested | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| \`${r.field}\` | ${r.required ? "yes" : ""} | ${r.status} | ${r.tested} | ${md(r.note)} |`),
    "",
  ].join("\n"),
);
writeFileSync(join(OUT, "coverage.json"), `${JSON.stringify(rows, null, 2)}\n`);

const lossMd = ["# Loss report (generated by run.mjs)", "", "Produced with `compareForLoss()` from `@knitli/openscg` (spec §7.5) by comparing each source guide with what `readWorkbook()` rebuilt from its XLSX.", ""];
for (const [name, r] of Object.entries(results)) {
  lossMd.push(`## ${name}`, "", `Workbook SHA-256: \`${r.sha256}\` (${r.bytes} bytes)`, "");
  lossMd.push(r.loss.items.length === 0 ? "**Nothing lost.**" : `**${r.loss.items.length} value(s) not preserved:**`, "");
  for (const i of r.loss.items) lossMd.push(`- \`${i.pointer}\` — ${i.kind}`);
  if (r.added.length) lossMd.push("", `Values present after the round trip that were not in the source: ${r.added.map((a) => `\`${a}\``).join(", ")}`);
  lossMd.push("");
}
writeFileSync(join(OUT, "loss-report.md"), lossMd.join("\n"));
writeFileSync(join(OUT, "loss-report.json"), `${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.loss])), null, 2)}\n`);

// ---------------------------------------------------------------------------
// 4. Formula injection
// ---------------------------------------------------------------------------
const inj = {};
{
  const bytes = readFileSync(join(OUT, "synthetic-injection.xlsx"));
  const zip = await JSZip.loadAsync(bytes);
  const sheetFiles = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
  let formulaElements = 0;
  const cellTypes = {};
  for (const f of sheetFiles) {
    const xml = await zip.file(f).async("string");
    formulaElements += (xml.match(/<f[ >]/g) ?? []).length;
    for (const m of xml.matchAll(/<c ([^>]*)>/g)) {
      const t = /\bt="(\w+)"/.exec(m[1])?.[1] ?? "(none)";
      cellTypes[t] = (cellTypes[t] ?? 0) + 1;
    }
  }
  const shared = await zip.file("xl/sharedStrings.xml").async("string");
  inj.sheet_xml_files = sheetFiles.length;
  inj.formula_elements = formulaElements;
  inj.cell_types = cellTypes;
  inj.shared_strings_sample = ["=1+1", "+1+1", "-1+1", "@SUM(1,1)", "=cmd|"].map((s) => [s, shared.includes(`>${s.replace(/&/g, "&amp;").replace(/'/g, "'")}`)]);

  // Independent check: let LibreOffice open the workbook and export the
  // Entries sheet to CSV. If it evaluated anything, "=1+1" would come out as 2.
  try {
    const tmp = join(OUT, "libreoffice");
    mkdirSync(tmp, { recursive: true });
    execFileSync(
      "soffice",
      ["--headless", "--norestore", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir", tmp, join(OUT, "synthetic-injection.xlsx")],
      { stdio: "pipe", timeout: 120000, env: { ...process.env, HOME: join(process.cwd(), OUT, "lo-home") } },
    );
    const csvs = readdirSync(tmp).filter((f) => f.endsWith(".csv"));
    const entriesCsv = csvs.find((f) => /Entries/.test(f));
    const text = readFileSync(join(tmp, entriesCsv), "utf8");
    inj.libreoffice = {
      csv_files: csvs.length,
      entries_csv: entriesCsv,
      // Column 5 is "Information described". Any value of exactly 2 means LibreOffice evaluated a formula.
      evaluated: text.split("\n").filter((l) => /^"?\d+"?,"?(eq|plus|minus|at|tab|dde)"?,/.test(l)).some((l) => /^[^,]*,[^,]*,[^,]*,[^,]*,"?2"?,/.test(l)),
      rows: text.split("\n").filter((l) => /^"?\d+"?,"?(eq|plus|minus|at|tab|cr|dde|crlf|spaces|ctrl|num)"?,/.test(l)).map((l) => l.slice(0, 80)),
    };
  } catch (e) {
    inj.libreoffice = { error: String(e).slice(0, 300) };
  }
  // Does the round trip preserve the exact injected text, including tab, CR and spaces?
  const src = parseStrict(readFileSync(FIXTURES["synthetic-injection"]));
  const back = JSON.parse(readFileSync(join(OUT, "synthetic-injection.roundtrip.json"), "utf8"));
  inj.exact_text_roundtrip = src.entries.map((e, i) => ({ entry_id: e.entry_id, same: back.entries[i]?.description === e.description, after: back.entries[i]?.description }));
  inj.title_roundtrip_same = back.title === src.title;
}

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------
const det = {};
{
  const g = parseStrict(readFileSync(FIXTURES["synthetic-lantern"]));
  const a = await writeWorkbook(g, { fixedTime: FIXED_TIME });
  await new Promise((r) => setTimeout(r, 2100));
  const b = await writeWorkbook(g, { fixedTime: FIXED_TIME });
  det.same_input_same_fixed_time_identical_bytes = sha(a) === sha(b);
  const c = await writeWorkbook(g);
  await new Promise((r) => setTimeout(r, 2100));
  const d = await writeWorkbook(g);
  det.default_time_identical_bytes = sha(c) === sha(d);
  // Where do the differences live?
  const diffEntries = async (x, y) => {
    const zx = await JSZip.loadAsync(x);
    const zy = await JSZip.loadAsync(y);
    const out = [];
    for (const f of Object.keys(zx.files)) {
      const fx = zx.files[f];
      const fy = zy.files[f];
      if (!fy) out.push(`${f}: missing`);
      else {
        if (fx.date?.getTime() !== fy.date?.getTime()) out.push(`${f}: zip timestamp ${fx.date?.toISOString()} vs ${fy.date?.toISOString()}`);
        if (!fx.dir && (await fx.async("string")) !== (await fy.async("string"))) out.push(`${f}: content differs`);
      }
    }
    return out;
  };
  det.fixed_time_differences = await diffEntries(a, b);
  det.default_time_differences = (await diffEntries(c, d)).slice(0, 12);
}

const summary = {
  versions: { exceljs: require("exceljs/package.json").version, openscg: require("@knitli/openscg/package.json").version, node: process.version },
  fixtures: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { sha256: v.sha256, loss_items: v.loss.items.length, loss: v.loss.items, added: v.added, roundtrip_structure_findings: v.roundtrip_structure_findings }])),
  coverage_totals: counts,
  injection: inj,
  determinism: det,
};
writeFileSync(join(OUT, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
