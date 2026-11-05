// SPDX-License-Identifier: AGPL-3.0-only
//
// A tiny, escape-by-default HTML template. Every interpolated value is escaped
// unless it is already a Safe fragment produced by `html` itself. Guide text
// is untrusted input (requirements §7), so there is no way to insert raw text
// without going through this escaping.

export class Safe {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

type Part = Safe | string | number | boolean | null | undefined | readonly Part[];

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return "";
  if (part instanceof Safe) return part.value;
  if (Array.isArray(part)) return part.map(render).join("");
  return escapeHtml(part);
}

export function html(strings: TemplateStringsArray, ...values: Part[]): Safe {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += render(values[i] as Part) + (strings[i + 1] ?? "");
  return new Safe(out);
}

/** Join fragments without a separator. */
export const join = (parts: readonly Part[]): Safe => new Safe(parts.map(render).join(""));

/** Render an attribute only when the condition holds, for example `checked`. */
export const attr = (name: string, on: boolean): Safe => new Safe(on ? ` ${name}` : "");
