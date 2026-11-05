// SPDX-License-Identifier: AGPL-3.0-only
// Guide-aware diff shared by both backends. Synthetic data only.
// Produces plain-language statements, not a raw JSON diff.

const json = (v) => (v === undefined ? "none" : JSON.stringify(v));
const same = (a, b) => json(a) === json(b);

// Fields people care about, in the order we report them, with readable names.
const ENTRY_FIELDS = [
  ["description", "description"],
  ["level", "level"],
  ["level_range", "level range"],
  ["condition_text", "condition"],
  ["references", "referenced entries"],
  ["controls", "controls"],
  ["reason", "reason"],
  ["declassification", "declassification instruction"],
  ["portion_marking", "portion marking"],
  ["statements", "explanatory statements"],
  ["sources", "sources"],
];

function describeLevel(e) {
  return e.level ?? (e.level_range ? `${e.level_range.lowest}–${e.level_range.highest}` : "none");
}

/** Compare two guides and return a list of plain-language change statements. */
export function diffGuides(a, b) {
  const out = [];
  for (const key of ["title", "scope", "oca", "document_markings", "dates"]) {
    if (!same(a[key], b[key])) out.push(`Guide ${key.replace("_", " ")} changed.`);
  }
  const before = new Map((a.entries ?? []).map((e) => [e.entry_id, e]));
  const after = new Map((b.entries ?? []).map((e) => [e.entry_id, e]));
  for (const [id, e] of after) {
    if (!before.has(id)) out.push(`Entry ${id} added (level ${describeLevel(e)}).`);
  }
  for (const [id, e] of before) {
    if (!after.has(id)) out.push(`Entry ${id} removed (was level ${describeLevel(e)}).`);
  }
  for (const [id, old] of before) {
    const now = after.get(id);
    if (!now) continue;
    for (const [field, label] of ENTRY_FIELDS) {
      if (same(old[field], now[field])) continue;
      if (field === "level" && old.level && now.level) {
        out.push(`Entry ${id} level changed from ${old.level} to ${now.level}.`);
      } else if (old[field] === undefined) {
        out.push(`Entry ${id} ${label} added.`);
      } else if (now[field] === undefined) {
        out.push(`Entry ${id} ${label} removed.`);
      } else {
        out.push(`Entry ${id} ${label} changed.`);
      }
    }
    const known = new Set(["entry_id", ...ENTRY_FIELDS.map(([f]) => f)]);
    const other = new Set([...Object.keys(old), ...Object.keys(now)].filter((k) => !known.has(k)));
    for (const k of other) if (!same(old[k], now[k])) out.push(`Entry ${id} ${k} changed.`);
  }
  return out;
}
