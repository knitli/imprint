// SPDX-License-Identifier: AGPL-3.0-only
// Builds one shared "view model" from the synthetic LANTERN guide so every
// renderer prints exactly the same content. Synthetic data only.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseStrict, payloadDigest, validate, isApprovalReady } from "@knitli/openscg";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("@knitli/openscg/package.json"));
const guide = parseStrict(await readFile(join(root, "examples/synthetic-lantern.json")));
const digest = await payloadDigest(guide);
const findings = validate(guide);

const LEVEL = { U: "UNCLASSIFIED", C: "CONFIDENTIAL", S: "SECRET", TS: "TOP SECRET" };
const level = (e) =>
  e.level_range
    ? `${e.level_range.lowest} to ${e.level_range.highest}: ${e.level_range.condition_text}`
    : e.level;
const declass = (d) => {
  if (!d) return "Not applicable";
  if (d.kind === "date") return `On ${d.date}`;
  if (d.kind === "event") return `On event: ${d.event_text}`;
  if (d.kind === "relative_to_record_creation") return `${d.years} years from the date the record was created`;
  return d.kind;
};

export const model = {
  synthetic: true,
  draft: !isApprovalReady(findings) || guide.lifecycle?.state !== "issued",
  banner: guide.document_markings.banner,
  title: guide.title,
  guide_id: guide.guide_id,
  revision_id: guide.revision_id,
  digest: `${digest.alg}:${digest.value}`,
  issuing_organization: guide.issuing_organization.name,
  oca: `${guide.oca.name}, ${guide.oca.position}`,
  poc: `${guide.point_of_contact.name}, ${guide.point_of_contact.position}`,
  issued: guide.dates.issued,
  next_review_due: guide.dates.next_review_due,
  introduction: guide.introduction,
  open_findings: findings.map((f) => `${f.code} (${f.severity}) at ${f.pointer}`),
  sections: guide.sections.map((s) => ({
    title: `${s.portion_marking} ${s.title}`,
    entries: guide.entries
      .filter((e) => e.section_id === s.section_id)
      .map((e) => ({
        id: e.entry_id,
        kind: e.kind,
        portion: e.portion_marking,
        description: e.description,
        level: level(e),
        // Typst template: short level in its column, range conditions in the text.
        level_short: e.level_range ? `${e.level_range.lowest} to ${e.level_range.highest}` : e.level,
        level_conditions: e.level_range?.condition_text ?? null,
        level_name: e.level ? LEVEL[e.level] : "Depends on conditions",
        controls: (e.controls ?? []).map((c) => c.marking).join(", ") || "None",
        reason: e.reason
          ? `${e.reason.categories.join(", ")}. ${e.reason.explanation}`
          : "Not required (unclassified)",
        declassification: declass(e.declassification),
        condition: e.condition_text ?? "",
        references: (e.references ?? []).join(", "),
      })),
  })),
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await writeFile("out/model.json", JSON.stringify(model, null, 2));
  console.log("wrote out/model.json", model.digest);
}
