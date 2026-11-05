// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Spike SP-07 checks, run with the preinstalled Playwright Chromium:
//   1. strict CSP: does in-page validation (ajv) run without 'unsafe-eval'?
//   2. per variant: axe-core, a keyboard-only pass, reflow at 320px,
//      bytes loaded, off-origin requests, screenshots.
// Writes results.json and screenshots/. Exits non-zero on a failed check.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { startServer } from "../serve.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const AXE_VERSION = require("axe-core/package.json").version;

mkdirSync("screenshots", { recursive: true });
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const results = { axe_core: AXE_VERSION, chromium: browser.version(), csp: {}, variants: {} };
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); return ok; };

async function open(path, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const log = { requests: [], offOrigin: [], bytes: 0, cspViolations: [], console: [] };
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || "(inline/eval)"}`));
  });
  page.on("console", (m) => log.console.push(`${m.type()}: ${m.text()}`));
  page.on("request", (r) => {
    log.requests.push(r.url());
    if (!r.url().startsWith(base)) log.offOrigin.push(r.url());
  });
  await page.goto(base + path);
  await page.waitForSelector("body[data-ready=true]");
  await page.waitForLoadState("networkidle");
  log.cspViolations = await page.evaluate(() => window.__csp);
  // Bytes loaded = size on disk of every file the page fetched (deterministic).
  for (const u of new Set(log.requests)) {
    const p = new URL(u).pathname;
    if (p.startsWith("/api/")) continue;
    try { log.bytes += statSync(`out${p === "/" ? "/index.html" : p}`).size; } catch {}
  }
  return { context, page, log };
}

async function axe(page, label) {
  await page.evaluate(AXE);
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { resultTypes: ["violations", "incomplete"] });
    const pick = (x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, help: x.help });
    return { violations: res.violations.map(pick), incomplete: res.incomplete.map(pick) };
  });
  return { state: label, ...r };
}

const describe = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return "body";
  return a.id ? `#${a.id}` : `${a.tagName.toLowerCase()}:${(a.textContent || "").trim().slice(0, 30)}`;
});
const attr = (page, id, name) => page.evaluate(([i, n]) => document.getElementById(i)?.getAttribute(n), [id, name]);

// ---- 1. CSP and the in-page validator --------------------------------------
{
  const strict = await open("/plain.html");
  results.csp.strict = {
    validator: await strict.page.evaluate(() => document.body.dataset.validator),
    error: await strict.page.evaluate(() => document.body.dataset.validatorError ?? null),
    violations: strict.log.cspViolations,
  };
  await strict.page.screenshot({ path: "screenshots/csp-strict-blocked.png" });
  await strict.context.close();

  const relaxed = await open("/plain.html?csp=relaxed");
  await relaxed.page.click("button[type=submit]");
  await relaxed.page.waitForSelector("#error-summary:not([hidden])");
  results.csp.relaxed_unsafe_eval = {
    validator: await relaxed.page.evaluate(() => document.body.dataset.validator),
    summary: await relaxed.page.textContent("#error-summary-heading"),
    violations: relaxed.log.cspViolations,
  };
  await relaxed.context.close();

  const server = await open("/plain.html?mode=server");
  results.csp.strict_with_server_validation = {
    validator: await server.page.evaluate(() => document.body.dataset.validator),
    violations: server.log.cspViolations,
  };
  await server.context.close();
  expect(results.csp.strict_with_server_validation.violations.length === 0, "server mode has CSP violations");
}

// ---- 2. Each variant ---------------------------------------------------------
for (const variant of ["uswds", "plain"]) {
  const r = { axe: [], keyboard: {} };
  const { context, page, log } = await open(`/${variant}.html?mode=server`);
  r.bytes_loaded = log.bytes;
  r.requests = log.requests.length;
  r.files = [...new Set(log.requests)].map((u) => new URL(u).pathname);
  r.off_origin_requests = log.offOrigin;
  r.csp_violations = log.cspViolations;
  expect(log.offOrigin.length === 0, `${variant}: off-origin requests`);
  expect(log.cspViolations.length === 0, `${variant}: CSP violations`);
  await page.screenshot({ path: `screenshots/${variant}-1-initial.png`, fullPage: true });
  r.axe.push(await axe(page, "initial"));

  // Keyboard only from here on. Record tab order up to the submit button.
  const order = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const d = await describe(page);
    order.push(d);
    if (d.startsWith("button")) break;
  }
  r.keyboard.tab_order = order;
  const fields = order.filter((d) => d.startsWith("#field") || d.startsWith("#cat"));
  expect(fields[0] === "#field-description" && fields.at(-1) === "#field-declass-kind",
    `${variant}: unexpected field tab order`);

  await page.keyboard.press("Enter"); // submit with the keyboard
  await page.waitForSelector("#error-summary:not([hidden])");
  r.keyboard.focus_after_submit = await describe(page);
  expect(r.keyboard.focus_after_submit === "#error-summary", `${variant}: focus did not move to error summary`);
  r.keyboard.summary = await page.textContent("#error-summary-heading");
  r.keyboard.summary_links = await page.$$eval("#error-summary-list a", (as) => as.map((a) => a.textContent));
  await page.screenshot({ path: `screenshots/${variant}-2-errors.png`, fullPage: true });
  r.axe.push(await axe(page, "with errors"));

  // Follow each summary link with the keyboard and check where focus lands.
  r.keyboard.links = [];
  const n = r.keyboard.summary_links.length;
  for (let i = 0; i < n; i++) {
    await page.focus("#error-summary");
    for (let t = 0; t <= i; t++) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const focused = await describe(page);
    r.keyboard.links.push({ link: r.keyboard.summary_links[i], focus_landed_on: focused });
  }
  const landed = r.keyboard.links.map((l) => l.focus_landed_on);
  expect(landed.includes("#cat-a") && landed.includes("#field-declass-kind"),
    `${variant}: summary links did not move focus to the fields`);
  r.keyboard.aria = {
    categories_fieldset_describedby: await attr(page, "group-categories", "aria-describedby"),
    declass_select_invalid: await attr(page, "field-declass-kind", "aria-invalid"),
    declass_select_describedby: await attr(page, "field-declass-kind", "aria-describedby"),
  };
  expect(r.keyboard.aria.categories_fieldset_describedby?.includes("error-categories"), `${variant}: fieldset error not described`);
  expect(r.keyboard.aria.declass_select_invalid === "true", `${variant}: aria-invalid missing`);
  expect(r.keyboard.aria.declass_select_describedby?.includes("error-declassification"), `${variant}: select error not described`);

  // Fix both problems with the keyboard only, then check again.
  await page.focus("#cat-a");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab"); // through the other checkboxes to the explanation
  for (let t = 0; t < 7; t++) await page.keyboard.press("Tab");
  expect((await describe(page)) === "#field-explanation", `${variant}: could not tab to explanation`);
  await page.keyboard.type("Synthetic rationale typed by the keyboard test.");
  await page.keyboard.press("Tab");
  // Select "A number of years after the record is created" with arrow keys.
  for (let t = 0; t < 3; t++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  expect((await describe(page)) === "#field-declass-years", `${variant}: years field not reachable after choosing kind`);
  await page.keyboard.type("25");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("status").textContent.length > 0);
  r.keyboard.after_fix = {
    status: await page.textContent("#status"),
    summary_hidden: await page.$eval("#error-summary", (e) => e.hidden),
    declass_select_invalid: await attr(page, "field-declass-kind", "aria-invalid"),
    declass_select_describedby: await attr(page, "field-declass-kind", "aria-describedby"),
    review_note: await page.$eval("#review-note", (e) => (e.hidden ? null : e.textContent.trim())),
  };
  expect(r.keyboard.after_fix.summary_hidden && r.keyboard.after_fix.declass_select_invalid === null,
    `${variant}: errors not cleared after fix`);
  await page.screenshot({ path: `screenshots/${variant}-3-fixed.png`, fullPage: true });
  r.axe.push(await axe(page, "after fix"));
  await context.close();

  // Reflow (WCAG 1.4.10): no horizontal scrolling at 320 CSS px.
  const narrow = await open(`/${variant}.html?mode=server`, { width: 320, height: 800 });
  await narrow.page.click("button[type=submit]");
  await narrow.page.waitForSelector("#error-summary:not([hidden])");
  r.reflow_320px_horizontal_scroll = await narrow.page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth);
  expect(!r.reflow_320px_horizontal_scroll, `${variant}: horizontal scroll at 320px`);
  await narrow.page.screenshot({ path: `screenshots/${variant}-4-narrow-errors.png`, fullPage: true });
  await narrow.context.close();

  for (const a of r.axe) expect(a.violations.length === 0, `${variant}: axe violations (${a.state}): ${a.violations.map((v) => v.id).join(", ")}`);
  results.variants[variant] = r;
}

await browser.close();
server.close();
results.failures = failures;
writeFileSync("results.json", JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
console.log(failures.length ? `\nFAILED:\n- ${failures.join("\n- ")}` : "\nAll checks passed.");
process.exitCode = failures.length ? 1 : 0;
