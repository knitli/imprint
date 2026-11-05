// SPDX-License-Identifier: AGPL-3.0-only
//
// Shared page pieces: the layout, form controls and findings display.
// Accessibility patterns come from spike SP-07: every control has a label,
// hints and errors are linked with aria-describedby, failing controls carry
// aria-invalid, and an error summary at the top links to each field.

import type { Finding } from "@knitli/openscg";
import type { FieldError } from "./forms.ts";
import { attr, html, join, type Safe } from "./html.ts";

export interface PageOptions {
  readonly title: string;
  readonly demo: boolean;
  readonly synthetic?: boolean;
  readonly breadcrumbs?: readonly { href: string; label: string }[];
  readonly flash?: string;
}

export function layout(opts: PageOptions, body: Safe): string {
  const crumbs = opts.breadcrumbs?.length
    ? html`<nav class="usa-breadcrumb" aria-label="Breadcrumbs"><ol class="usa-breadcrumb__list">
        ${opts.breadcrumbs.map(
          (c) =>
            html`<li class="usa-breadcrumb__list-item"><a class="usa-breadcrumb__link" href="${c.href}"><span>${c.label}</span></a></li>`,
        )}
        <li class="usa-breadcrumb__list-item usa-current" aria-current="page"><span>${opts.title}</span></li>
      </ol></nav>`
    : "";
  const modeNotice = opts.demo
    ? html`<div class="usa-site-alert usa-site-alert--emergency imprint-mode" aria-label="Demo notice"><div class="usa-alert"><div class="usa-alert__body"><p class="usa-alert__text"><strong>Demo: synthetic data only.</strong> Do not enter real, controlled or classified information. Anything you enter may be seen by others and is not kept.</p></div></div></div>`
    : html`<div class="usa-site-alert usa-site-alert--info imprint-mode" aria-label="Use notice"><div class="usa-alert"><div class="usa-alert__body"><p class="usa-alert__text">Use Imprint only with information this system is authorized to hold. Imprint helps you write guidance; it does not grant classification authority or approve a guide.</p></div></div></div>`;
  const synthetic = opts.synthetic
    ? html`<div class="usa-alert usa-alert--warning usa-alert--slim imprint-synthetic"><div class="usa-alert__body"><p class="usa-alert__text"><strong>SYNTHETIC GUIDE.</strong> This guide is marked as invented. It is not real classification guidance.</p></div></div>`
    : "";
  const flash = opts.flash
    ? html`<div class="usa-alert usa-alert--success usa-alert--slim" role="status"><div class="usa-alert__body"><p class="usa-alert__text">${opts.flash}</p></div></div>`
    : "";
  return `<!doctype html>${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} | Imprint</title>
<link rel="stylesheet" href="/assets/uswds/css/uswds.min.css">
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/uswds/js/uswds-init.min.js"></script>
</head>
<body>
<a class="usa-skipnav" href="#main-content">Skip to main content</a>
${modeNotice}
<header class="usa-header usa-header--basic imprint-header">
  <div class="usa-nav-container">
    <div class="usa-navbar"><div class="usa-logo"><em class="usa-logo__text"><a href="/" title="Imprint home">Imprint</a></em></div></div>
  </div>
</header>
<main id="main-content" class="grid-container imprint-main" tabindex="-1">
${crumbs}
${synthetic}
${flash}
${body}
</main>
<footer class="usa-footer usa-footer--slim imprint-footer"><div class="grid-container"><p>Imprint implements OpenSCG 0.1.0. OpenSCG is a proposed open format, not an official government standard.</p></div></footer>
<script src="/assets/uswds/js/uswds.min.js"></script>
<script src="/assets/app.js"></script>
</body>
</html>`}`;
}

// ---- Form controls ---------------------------------------------------------

export interface FieldOpts {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly value?: string;
  readonly errors?: readonly FieldError[];
  readonly required?: boolean;
}

const fid = (name: string): string => `f-${name}`;

function errorFor(name: string, errors?: readonly FieldError[]): string | undefined {
  return errors?.find((e) => e.field === name)?.message;
}

function describedBy(id: string, hint?: string, error?: string): Safe {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return ids ? html` aria-describedby="${ids}"` : html``;
}

function frame(o: FieldOpts, control: Safe, error?: string): Safe {
  const id = fid(o.name);
  return html`<div class="usa-form-group${error ? " usa-form-group--error" : ""}">
  <label class="usa-label${error ? " usa-label--error" : ""}" for="${id}">${o.label}${o.required ? html` <abbr title="required" class="usa-hint usa-hint--required">*</abbr>` : ""}</label>
  ${o.hint ? html`<div class="usa-hint" id="${id}-hint">${o.hint}</div>` : ""}
  ${error ? html`<span class="usa-error-message" id="${id}-error" role="alert">${error}</span>` : ""}
  ${control}
</div>`;
}

export function input(
  o: FieldOpts & { type?: string; width?: string; inputmode?: string; autocomplete?: string },
): Safe {
  const id = fid(o.name);
  const error = errorFor(o.name, o.errors);
  const cls = `usa-input${o.width ? ` usa-input--${o.width}` : ""}${error ? " usa-input--error" : ""}`;
  return frame(
    o,
    html`<input class="${cls}" id="${id}" name="${o.name}" type="${o.type ?? "text"}" value="${o.value ?? ""}"${
      o.inputmode ? html` inputmode="${o.inputmode}"` : ""
    }${o.autocomplete ? html` autocomplete="${o.autocomplete}"` : ""}${attr("required", !!o.required)}${attr('aria-invalid="true"', !!error)}${describedBy(id, o.hint, error)}>`,
    error,
  );
}

export function textarea(o: FieldOpts & { rows?: number }): Safe {
  const id = fid(o.name);
  const error = errorFor(o.name, o.errors);
  return frame(
    o,
    html`<textarea class="usa-textarea${error ? " usa-input--error" : ""}" id="${id}" name="${o.name}" rows="${o.rows ?? 4}"${attr("required", !!o.required)}${attr('aria-invalid="true"', !!error)}${describedBy(id, o.hint, error)}>${o.value ?? ""}</textarea>`,
    error,
  );
}

export function select(
  o: FieldOpts & { options: readonly { value: string; label: string }[]; blank?: string },
): Safe {
  const id = fid(o.name);
  const error = errorFor(o.name, o.errors);
  return frame(
    o,
    html`<select class="usa-select${error ? " usa-input--error" : ""}" id="${id}" name="${o.name}"${attr("required", !!o.required)}${attr('aria-invalid="true"', !!error)}${describedBy(id, o.hint, error)}>
      ${o.blank !== undefined ? html`<option value="">${o.blank}</option>` : ""}
      ${o.options.map((op) => html`<option value="${op.value}"${attr("selected", op.value === o.value)}>${op.label}</option>`)}
    </select>`,
    error,
  );
}

/** A group of radios or checkboxes in a fieldset. The first control gets the field's id for error links. */
export function choices(
  o: Omit<FieldOpts, "value"> & {
    type: "radio" | "checkbox";
    options: readonly { value: string; label: string; hint?: string }[];
    selected: readonly string[];
    tile?: boolean;
  },
): Safe {
  const id = fid(o.name);
  const error = errorFor(o.name, o.errors);
  return html`<div class="usa-form-group${error ? " usa-form-group--error" : ""}">
  <fieldset class="usa-fieldset"${describedBy(id, o.hint, error)}>
    <legend class="usa-legend${error ? " usa-label--error" : ""}">${o.label}</legend>
    ${o.hint ? html`<div class="usa-hint" id="${id}-hint">${o.hint}</div>` : ""}
    ${error ? html`<span class="usa-error-message" id="${id}-error" role="alert">${error}</span>` : ""}
    ${o.options.map((op, i) => {
      const cid = i === 0 ? id : `${id}-${i}`;
      return html`<div class="usa-${o.type}">
        <input class="usa-${o.type}__input${o.tile ? ` usa-${o.type}__input--tile` : ""}" id="${cid}" type="${o.type}" name="${o.name}" value="${op.value}"${attr("checked", o.selected.includes(op.value))}${attr('aria-invalid="true"', !!error)}>
        <label class="usa-${o.type}__label" for="${cid}">${op.label}${op.hint ? html`<span class="usa-${o.type}__label-description">${op.hint}</span>` : ""}</label>
      </div>`;
    })}
  </fieldset>
</div>`;
}

export function errorSummary(errors: readonly FieldError[], heading = "There is a problem"): Safe {
  if (!errors.length) return html``;
  return html`<div class="usa-alert usa-alert--error imprint-error-summary" id="error-summary" tabindex="-1" aria-labelledby="error-summary-heading">
  <div class="usa-alert__body">
    <h2 class="usa-alert__heading" id="error-summary-heading">${heading}</h2>
    <ul class="usa-list">${errors.map((e) => html`<li><a href="#${fid(e.field)}">${e.message}</a></li>`)}</ul>
  </div>
</div>`;
}

export const submit = (
  label: string,
  opts: { secondary?: boolean; name?: string; value?: string } = {},
): Safe =>
  html`<button class="usa-button${opts.secondary ? " usa-button--outline" : ""}" type="submit"${
    opts.name ? html` name="${opts.name}" value="${opts.value ?? ""}"` : ""
  }>${label}</button>`;

// ---- Findings ----------------------------------------------------------------

export const SEVERITY_LABEL: Record<string, { label: string; alert: string; blocks: boolean }> = {
  error: { label: "Must fix before freezing", alert: "error", blocks: true },
  unsupported: { label: "Not supported: blocks freezing", alert: "error", blocks: true },
  policy_review: { label: "Needs a person to decide", alert: "info", blocks: true },
  warning: { label: "Check this", alert: "warning", blocks: false },
};

/** Where a finding should send the author: a page and a field. */
export interface FindingTarget {
  readonly href: string;
  readonly where: string;
}

export function findingTarget(base: string, pointer: string, entryIds: readonly string[]): FindingTarget {
  const parts = pointer.split("/").slice(1);
  const [top, second, third, fourth] = parts;
  const entryField: Record<string, string> = {
    entry_id: "entry_id",
    kind: "kind",
    section_id: "section_id",
    regime: "regime",
    description: "description",
    level: "level",
    level_range: "range_lowest",
    condition_text: "condition_text",
    references: "references",
    controls: "control_marking_0",
    reason: "reason_categories",
    declassification: "declass_kind",
    sources: "source_citation_0",
    statements: "statement_value",
  };
  if (top === "entries" && second !== undefined && /^\d+$/.test(second)) {
    let field = entryField[third ?? ""] ?? "description";
    if (third === "reason" && fourth === "explanation") field = "reason_explanation";
    if (third === "declassification" && fourth === "authority") field = "evidence_reference";
    if (third === "declassification" && fourth === "code") field = "exempt_code";
    const id = entryIds[Number(second)];
    return {
      href: `${base}/entries/${second}#f-${field}`,
      where: id ? `Entry ${id}` : `Entry ${Number(second) + 1}`,
    };
  }
  if (top === "entries") return { href: `${base}/entries/new`, where: "Entries" };
  if (top === "document_markings") {
    const f: Record<string, string> = {
      classification: "classification",
      banner: "banner",
      controls: "controls",
      classification_authority_block: "cab_classified_by",
      review: "review_status",
    };
    return { href: `${base}/markings#f-${f[second ?? ""] ?? "classification"}`, where: "Document markings" };
  }
  if (top === "sections") return { href: `${base}/sections#f-section_id_${second ?? 0}`, where: "Sections" };
  const details: Record<string, string> = {
    title: "title",
    subject: "subject",
    scope: "scope",
    revision_id: "revision_id",
    profile: "profile",
    introduction: "introduction",
    issuing_organization: "org_name",
    point_of_contact: "poc_name",
    oca: second === "highest_level" ? "oca_highest_level" : "oca_name",
    dates: "date_issued",
    authority: second === "claimed_delegation" ? "delegation_highest_level" : "signer_name",
  };
  if (top && details[top]) return { href: `${base}/details#f-${details[top]}`, where: "Guide details" };
  return { href: base, where: "Whole guide" };
}

export function findingsList(base: string, findings: readonly Finding[], entryIds: readonly string[]): Safe {
  if (!findings.length) {
    return html`<div class="usa-alert usa-alert--success usa-alert--slim"><div class="usa-alert__body"><p class="usa-alert__text">No problems found by OpenSCG 0.1.0 checks. This is not a compliance or approval decision.</p></div></div>`;
  }
  const order = ["error", "unsupported", "policy_review", "warning"];
  return join(
    order.map((sev) => {
      const group = findings.filter((f) => f.severity === sev);
      if (!group.length) return "";
      const meta = SEVERITY_LABEL[sev] ?? { label: sev, alert: "info", blocks: false };
      return html`<section class="imprint-findings" aria-labelledby="findings-${sev}">
        <h3 id="findings-${sev}">${meta.label} (${group.length})</h3>
        <ul class="usa-list">
          ${group.map((f) => {
            const t = findingTarget(base, f.pointer, entryIds);
            return html`<li><a href="${t.href}">${t.where}</a>: ${f.message} <span class="imprint-code">${f.code}</span></li>`;
          })}
        </ul>
      </section>`;
    }),
  );
}
