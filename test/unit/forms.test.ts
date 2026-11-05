// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validate } from "@knitli/openscg";
import {
  detailsToForm,
  entryToForm,
  markingsToForm,
  parseDetailsForm,
  parseEntryForm,
  parseMarkingsForm,
  parseSectionsForm,
  sectionsToForm,
} from "../../src/web/forms.ts";
import { fixture, LANTERN, LANTERN_REVIEWED } from "../helpers/fixtures.ts";

type Doc = Record<string, unknown>;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("form round trips: guide data → form → guide data changes nothing", () => {
  for (const file of [LANTERN, LANTERN_REVIEWED, "examples/requirements-compilation.json"]) {
    it(`every entry in ${file}`, async () => {
      const doc = await fixture(file);
      for (const entry of doc.entries as Doc[]) {
        const { value, errors } = parseEntryForm(entryToForm(entry), entry);
        assert.deepEqual(errors, [], `entry ${entry.entry_id}`);
        assert.deepEqual(plain(value), plain(entry), `entry ${entry.entry_id}`);
      }
    });
    it(`details, markings and sections in ${file}`, async () => {
      const doc = await fixture(file);
      for (const [toForm, parse] of [
        [detailsToForm, (f: URLSearchParams, d: Doc) => parseDetailsForm(f, d, { demo: false })],
        [markingsToForm, parseMarkingsForm],
        [sectionsToForm, parseSectionsForm],
      ] as const) {
        const { value, errors } = parse(toForm(doc), doc);
        assert.deepEqual(errors, []);
        assert.deepEqual(plain(value), plain(doc));
      }
    });
  }
});

function entryForm(fields: Record<string, string | string[]>): URLSearchParams {
  const f = new URLSearchParams({
    entry_id: "e1",
    kind: "element",
    description: "Synthetic item",
    level_mode: "single",
    level: "S",
    declass_kind: "none",
  });
  for (const [k, v] of Object.entries(fields)) {
    f.delete(k);
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}
const fieldsOf = (r: { errors: readonly { field: string }[] }) => r.errors.map((e) => e.field).sort();

describe("entry form input checks", () => {
  it("refuses values that would break the file's structure, field by field", () => {
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ entry_id: "../bad" }), {})), ["entry_id"]);
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ description: "  " }), {})), ["description"]);
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ level: "" }), {})), ["level"]);
    assert.deepEqual(
      fieldsOf(parseEntryForm(entryForm({ declass_kind: "date", declass_date: "2026-02-30" }), {})),
      ["declass_date"],
    );
    assert.deepEqual(
      fieldsOf(
        parseEntryForm(entryForm({ declass_kind: "relative_to_record_creation", declass_years: "25.5" }), {}),
      ),
      ["declass_years"],
    );
    assert.deepEqual(
      fieldsOf(parseEntryForm(entryForm({ declass_kind: "exemption", exempt_code: "26X1" }), {})),
      ["exempt_code"],
    );
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ reason_explanation: "Because" }), {})), [
      "reason_categories",
    ]);
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ reason_categories: "1.4(a)" }), {})), [
      "reason_explanation",
    ]);
    assert.deepEqual(fieldsOf(parseEntryForm(entryForm({ level_mode: "range" }), {})), [
      "range_condition",
      "range_highest",
      "range_lowest",
    ]);
  });

  it("saves content problems instead, for OpenSCG to report", () => {
    const { value, errors } = parseEntryForm(entryForm({}), {});
    assert.deepEqual(errors, []);
    const guide = {
      schema_version: "0.1.0",
      profile: "cnsi-core",
      guide_id: "urn:uuid:x",
      revision_id: "r1",
      title: "T",
      lifecycle: { state: "draft" },
      document_markings: { classification: "U" },
      entries: [value],
    };
    const codes = validate(guide).map((f) => `${f.code} ${f.pointer}`);
    assert.ok(codes.includes("OSCG-V010 /entries/0/reason"));
    assert.ok(codes.includes("OSCG-V013 /entries/0/declassification"));
    assert.ok(!codes.some((c) => c.startsWith("OSCG-S")));
  });

  it("keeps a relative instruction relative (M-03)", () => {
    const { value } = parseEntryForm(
      entryForm({ declass_kind: "relative_to_record_creation", declass_years: "25" }),
      {},
    );
    assert.deepEqual(value.declassification, { kind: "relative_to_record_creation", years: 25 });
  });

  it("keeps extensions and other fields the form does not own", () => {
    const entry = {
      entry_id: "e1",
      kind: "element",
      description: "x",
      level: "U",
      extensions: { "org.example.thing": { must_understand: false, data: { a: [1, 2] } } },
    };
    const { value } = parseEntryForm(entryToForm(entry), entry);
    assert.deepEqual(value.extensions, entry.extensions);
  });

  it("removes rows marked for removal and ignores blank rows", () => {
    const f = entryForm({
      control_marking_0: "NOFORN",
      control_kind_0: "dissemination",
      control_marking_1: "FOUO",
      control_kind_1: "handling",
      control_remove_1: "on",
      control_marking_2: "",
    });
    assert.deepEqual(parseEntryForm(f, {}).value.controls, [{ marking: "NOFORN", kind: "dissemination" }]);
  });
});

describe("details form", () => {
  it("requires the synthetic mark in demo mode", () => {
    const f = new URLSearchParams({ title: "T", revision_id: "r1", profile: "cnsi-core" });
    assert.deepEqual(fieldsOf(parseDetailsForm(f, {}, { demo: true })), ["synthetic"]);
    assert.deepEqual(fieldsOf(parseDetailsForm(f, {}, { demo: false })), []);
  });
  it("needs a signer name or identifier when any authority claim is given", () => {
    const f = new URLSearchParams({ title: "T", revision_id: "r1", delegation_highest_level: "S" });
    assert.deepEqual(fieldsOf(parseDetailsForm(f, {}, { demo: false })), ["signer_name"]);
  });
});
