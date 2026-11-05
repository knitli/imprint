// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike SP-07. Shared behaviour for both page variants: load a synthetic guide,
// edit one entry, check it with OpenSCG, and show each finding next to the
// field its JSON pointer names. Only CSS class names differ between variants.
//
// Synthetic data only. Not product code.

import { validate } from "@knitli/openscg";
import lantern from "../node_modules/@knitli/openscg/examples/synthetic-lantern.json";

const LEVELS = { U: "Unclassified", C: "Confidential", S: "Secret", TS: "Top Secret" };

// Plain-language messages, keyed by the field a finding points at. OpenSCG's own
// structural messages come from the JSON Schema library ("Schema check
// minLength failed…"), which is not written for authors.
const FIELD_MESSAGES = {
  description: "Describe the information this entry covers.",
  level: "Choose a classification level.",
  categories: "Choose at least one E.O. 13526 section 1.4 category.",
  explanation: "Explain why this information is classified.",
  declassification: "Say when or how this information is declassified.",
  "declass-date": "Enter the declassification date.",
  "declass-event": "Describe the event that ends classification.",
  "declass-years": "Enter a number of years from 1 to 75.",
  "declass-code": "Enter an exemption code, such as 25X1 or 50X1-HUM.",
};

// JSON pointer (relative to the entry) -> form field key.
function fieldForPointer(rest) {
  if (rest === "/description") return "description";
  if (rest === "/level" || rest.startsWith("/level_range")) return "level";
  if (rest === "/reason" || rest.startsWith("/reason/categories")) return "categories";
  if (rest.startsWith("/reason/explanation")) return "explanation";
  if (rest === "/declassification") return "declassification";
  if (rest.startsWith("/declassification/date")) return "declass-date";
  if (rest.startsWith("/declassification/event_text")) return "declass-event";
  if (rest.startsWith("/declassification/years")) return "declass-years";
  if (rest.startsWith("/declassification/code")) return "declass-code";
  return null;
}

// Where focus goes for each field key (for a group, its first control).
const FOCUS_TARGET = {
  description: "field-description",
  level: "field-level",
  categories: "cat-a",
  explanation: "field-explanation",
  declassification: "field-declass-kind",
  "declass-date": "field-declass-date",
  "declass-event": "field-declass-event",
  "declass-years": "field-declass-years",
  "declass-code": "field-declass-code",
};
// Fields rendered as a fieldset (error goes on the group, not one control).
const GROUPS = new Set(["categories"]);

const $ = (id) => document.getElementById(id);

export async function start(variant) {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "server" ? "server" : "browser";
  document.body.dataset.mode = mode;

  // Synthetic error: remove the reason and the declassification instruction
  // from a Secret entry, so OpenSCG reports two blocking findings.
  const guide = structuredClone(lantern);
  const target = guide.entries.find((e) => e.entry_id === "perf-range");
  delete target.reason;
  delete target.declassification;

  let selected = guide.entries.indexOf(target);
  let lastFindings = [];

  const validator = await loadValidator(mode);

  function readForm() {
    const e = structuredClone(guide.entries[selected]); // keep fields we do not edit
    e.description = $("field-description").value;
    const level = $("field-level").value;
    if (level) {
      e.level = level;
      delete e.level_range;
    } else if (!e.level_range) delete e.level;
    const cats = [...document.querySelectorAll("input[name=categories]:checked")].map((c) => c.value);
    const explanation = $("field-explanation").value;
    if (cats.length || explanation) {
      e.reason = { ...(e.reason ?? {}), categories: cats };
      if (explanation) e.reason.explanation = explanation;
      else delete e.reason.explanation;
    } else delete e.reason;
    const kind = $("field-declass-kind").value;
    if (!kind) delete e.declassification;
    else if (kind === "date") e.declassification = { kind, date: $("field-declass-date").value };
    else if (kind === "event") e.declassification = { kind, event_text: $("field-declass-event").value };
    else if (kind === "relative_to_record_creation")
      e.declassification = { kind, years: Number($("field-declass-years").value) || 0 };
    else if (kind === "exemption") e.declassification = { kind, code: $("field-declass-code").value };
    return e;
  }

  function fillForm(e) {
    $("editor-heading").textContent = `Edit entry ${e.entry_id}`;
    $("field-description").value = e.description ?? "";
    $("field-level").value = e.level ?? "";
    $("level-range-note").hidden = !e.level_range;
    for (const c of document.querySelectorAll("input[name=categories]"))
      c.checked = e.reason?.categories?.includes(c.value) ?? false;
    $("field-explanation").value = e.reason?.explanation ?? "";
    const d = e.declassification ?? {};
    $("field-declass-kind").value = d.kind ?? "";
    $("field-declass-date").value = d.date ?? "";
    $("field-declass-event").value = d.event_text ?? "";
    $("field-declass-years").value = d.years ?? "";
    $("field-declass-code").value = d.code ?? "";
    showDeclassField();
  }

  function showDeclassField() {
    const kind = $("field-declass-kind").value;
    const map = {
      date: "group-declass-date",
      event: "group-declass-event",
      relative_to_record_creation: "group-declass-years",
      exemption: "group-declass-code",
    };
    for (const id of Object.values(map)) $(id).hidden = map[kind] !== id;
  }

  function renderList() {
    const counts = new Map();
    for (const f of lastFindings) {
      const m = /^\/entries\/(\d+)/.exec(f.pointer);
      if (m && f.severity === "error") counts.set(Number(m[1]), (counts.get(Number(m[1])) ?? 0) + 1);
    }
    const list = $("entry-list");
    list.replaceChildren();
    guide.entries.forEach((e, i) => {
      const li = document.createElement("li");
      li.className = variant.classes.listItem;
      const a = document.createElement("a");
      a.href = `#entry-${e.entry_id}`;
      a.className = variant.classes.listLink;
      const level = e.level ? LEVELS[e.level] : `${LEVELS[e.level_range.lowest]} to ${LEVELS[e.level_range.highest]}`;
      a.textContent = `${e.entry_id}: ${level}`;
      if (i === selected) a.setAttribute("aria-current", "true");
      const n = counts.get(i);
      if (n) {
        // State is given in text, not colour alone.
        const s = document.createElement("span");
        s.className = variant.classes.listProblem;
        s.textContent = ` (${n} ${n === 1 ? "problem" : "problems"})`;
        a.append(s);
      }
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        guide.entries[selected] = readForm();
        selected = i;
        clearErrors();
        fillForm(guide.entries[i]);
        renderList();
        $("editor-heading").focus();
      });
      li.append(a);
      list.append(li);
    });
  }

  function clearErrors() {
    $("error-summary").hidden = true;
    for (const key of Object.keys(FOCUS_TARGET)) setFieldError(key, null);
  }

  function setFieldError(key, message) {
    const group = $(`group-${key}`);
    const msg = $(`error-${key}`);
    if (!group || !msg) return;
    const control = GROUPS.has(key) ? group : $(FOCUS_TARGET[key]);
    // aria-describedby still announces hidden elements, so add and remove the
    // error's id rather than only hiding it.
    const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
      .filter((id) => id !== msg.id);
    if (message) {
      msg.textContent = message;
      msg.hidden = false;
      group.classList.add(...variant.classes.groupError);
      if (!GROUPS.has(key)) {
        control.setAttribute("aria-invalid", "true");
        control.classList.add(...variant.classes.inputError);
      }
      ids.unshift(msg.id);
    } else {
      msg.textContent = "";
      msg.hidden = true;
      group.classList.remove(...variant.classes.groupError);
      if (!GROUPS.has(key)) {
        control.removeAttribute("aria-invalid");
        control.classList.remove(...variant.classes.inputError);
      }
    }
    if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
    else control.removeAttribute("aria-describedby");
  }

  async function check() {
    guide.entries[selected] = readForm();
    lastFindings = await validator(guide);
    clearErrors();
    const prefix = `/entries/${selected}`;
    const fieldErrors = [];
    const review = [];
    const other = [];
    for (const f of lastFindings) {
      const key = f.pointer.startsWith(prefix + "/") || f.pointer === prefix
        ? fieldForPointer(f.pointer.slice(prefix.length))
        : null;
      if (key && f.severity === "error") fieldErrors.push({ key, f });
      else if (f.severity === "policy_review") review.push(f);
      else if (!f.pointer.startsWith(prefix)) continue; // other entries: shown in the list
      else other.push(f);
    }
    const seen = new Set();
    const items = $("error-summary-list");
    items.replaceChildren();
    for (const { key, f } of fieldErrors) {
      if (seen.has(key)) continue;
      seen.add(key);
      const text = FIELD_MESSAGES[key] ?? f.message;
      setFieldError(key, text);
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#${FOCUS_TARGET[key]}`;
      a.className = variant.classes.summaryLink;
      a.textContent = text;
      a.dataset.code = f.code;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        const el = $(FOCUS_TARGET[key]);
        // Bring the label (or legend) into view too, not just the control.
        ($(`group-${key}`) ?? el).scrollIntoView({ block: "start" });
        el.focus({ preventScroll: true });
      });
      li.append(a);
      items.append(li);
    }
    for (const f of other) {
      const li = document.createElement("li");
      li.textContent = `${f.message} (${f.code})`;
      items.append(li);
    }
    const count = seen.size + other.length;
    $("error-summary-heading").textContent =
      count === 0 ? "" : `There ${count === 1 ? "is 1 problem" : `are ${count} problems`} with this entry`;
    $("error-summary").hidden = count === 0;
    // Things a person must review are not errors in this entry; say so separately.
    $("review-note").hidden = review.length === 0;
    $("review-note-text").textContent = review.map((f) => f.message).join(" ");
    $("status").textContent =
      count === 0 ? "No problems found in this entry. This is not an approval." : "";
    renderList();
    if (count) $("error-summary").focus();
  }

  $("field-declass-kind").addEventListener("change", showDeclassField);
  $("entry-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    check();
  });

  fillForm(guide.entries[selected]);
  renderList();
  document.body.dataset.ready = "true";
}

// Validation runs in the page by default. ?mode=server posts the guide to the
// local server instead, which is what a strict Content Security Policy forces
// if the in-page validator needs eval (see README).
async function loadValidator(mode) {
  const status = document.body.dataset;
  if (mode === "server") {
    status.validator = "server";
    return async (guide) => {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(guide),
      });
      return res.json();
    };
  }
  try {
    validate(structuredClone(lantern)); // compiles the schema on first use
    status.validator = "browser";
    return async (guide) => validate(guide);
  } catch (e) {
    status.validator = "blocked";
    status.validatorError = `${e.name}: ${e.message}`;
    $("validator-blocked").hidden = false;
    return async () => [];
  }
}
