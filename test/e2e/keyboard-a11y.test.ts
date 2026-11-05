// SPDX-License-Identifier: AGPL-3.0-only
//
// M-14: complete create → validate → freeze → export with the keyboard alone,
// and run axe-core on every page along the way. Synthetic data only.
//
// The page's Content Security Policy blocks injected script tags, so axe is
// loaded with page.evaluate(), which the browser runs outside the page's CSP.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { startServer } from "../helpers/server.ts";

const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function axe(page: Page, label: string): Promise<void> {
  await page.evaluate(AXE);
  const result = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return r.violations.map(
      (v: { id: string; nodes: { target: string[] }[] }) =>
        `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  });
  assert.deepEqual(result, [], `axe violations on ${label}`);
}

const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");

/** Press Tab until the element with this id has focus. Proves it is reachable by keyboard. */
async function tabTo(page: Page, id: string, max = 250): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await activeId(page)) === id) return;
    await page.keyboard.press("Tab");
  }
  assert.fail(`could not reach #${id} with Tab`);
}

/** Tab to a link or button by its text, then return. */
async function tabToText(page: Page, text: string, max = 250): Promise<void> {
  for (let i = 0; i < max; i++) {
    const t = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "",
    );
    if (t === text) return;
    await page.keyboard.press("Tab");
  }
  assert.fail(`could not reach "${text}" with Tab`);
}

async function typeInto(page: Page, id: string, text: string): Promise<void> {
  await tabTo(page, id);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

/** Choose an option in a focused select by typing its first letters, as a keyboard user would. */
async function chooseIn(page: Page, id: string, typed: string, expected: string): Promise<void> {
  await tabTo(page, id);
  await page.keyboard.type(typed);
  assert.equal(
    await page.evaluate((x) => (document.getElementById(x) as HTMLSelectElement).value, id),
    expected,
  );
}

/** Press a key that submits a form or follows a link, and wait for the new page. */
async function press(page: Page, key: string): Promise<void> {
  const navigated = page.waitForEvent("framenavigated", { timeout: 10_000 });
  await page.keyboard.press(key);
  await navigated;
  await page.waitForLoadState("load");
}

describe("keyboard-only workflow with accessibility checks (M-14)", () => {
  let browser: Browser;
  let s: Awaited<ReturnType<typeof startServer>>;
  let page: Page;
  const outside: string[] = [];
  const cspViolations: string[] = [];

  before(async () => {
    s = await startServer(true);
    browser = await chromium.launch();
    page = await browser.newPage({ acceptDownloads: true });
    page.on("request", (r) => {
      if (!r.url().startsWith(s.base)) outside.push(r.url());
    });
    page.on("console", (m) => {
      if (/Content Security Policy/.test(m.text())) cspViolations.push(m.text());
    });
  });
  after(async () => {
    await browser?.close();
    await s?.stop();
  });

  it("works from a blank guide to a frozen revision and a download", async () => {
    await page.goto(`${s.base}/`);
    await axe(page, "home");

    // 1. Start a guide.
    await typeInto(page, "f-title", "Synthetic keyboard guide");
    await chooseIn(page, "f-classification", "U", "U");
    await tabToText(page, "Start guide");
    await press(page, "Enter");
    assert.match(page.url(), /\/guides\/[0-9a-f]{32}\?saved=created$/);
    await axe(page, "new guide overview");

    // 2. Add an entry, first with a mistake the form refuses.
    await tabToText(page, "Add an entry");
    await press(page, "Enter");
    await axe(page, "entry editor");
    await typeInto(page, "f-entry_id", "kb-range");
    await typeInto(page, "f-description", "The maximum range of the synthetic sensor, as a specific figure.");
    await chooseIn(page, "f-level", "S", "S");
    // A radio group is one Tab stop; arrow keys change the choice.
    await tabTo(page, "f-declass_kind"); // "None" is selected
    await page.keyboard.press("ArrowDown"); // "On a date"
    assert.equal(await activeId(page), "f-declass_kind-1");
    await typeInto(page, "f-declass_date", "2040-02-30");
    await tabToText(page, "Add entry");
    await press(page, "Enter");

    // The error summary takes focus, and its link moves focus to the field.
    assert.equal(await activeId(page), "error-summary");
    await axe(page, "entry editor with errors");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    assert.equal(await activeId(page), "f-declass_date");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("2040-12-31");
    await tabToText(page, "Add entry");
    await press(page, "Enter");
    assert.match(page.url(), /\/entries\/0\?saved=saved$/);

    // Saved, but OpenSCG reports the missing reason.
    assert.match(await page.content(), /OSCG-V010/);
    await axe(page, "entry with findings");

    // 3. Give the reason.
    await tabTo(page, "f-reason_categories");
    await page.keyboard.press("Space");
    await typeInto(
      page,
      "f-reason_explanation",
      "Synthetic rationale: the exact range would let an adversary plan around it.",
    );
    await tabToText(page, "Save entry");
    await press(page, "Enter");
    assert.doesNotMatch(await page.content(), /OSCG-V010/);

    // 4. Guide details.
    await page.goto(page.url().replace(/\/entries\/0.*$/, "/details"));
    await axe(page, "details");
    await typeInto(page, "f-subject", "A synthetic training sensor.");
    await typeInto(page, "f-poc_name", "Jordan Example (fictional)");
    await typeInto(page, "f-oca_name", "Casey Sample (fictional)");
    await typeInto(page, "f-oca_position", "Director, Example Programs (fictional)");
    await chooseIn(page, "f-oca_highest_level", "S", "S");
    await typeInto(page, "f-date_issued", "2026-11-01");
    await tabToText(page, "Save");
    await press(page, "Enter");
    assert.match(page.url(), /\?saved=saved$/);

    // 5. The guide's own markings, reviewed by a person.
    await page.goto(page.url().replace(/\?.*$/, "/markings"));
    await axe(page, "markings");
    await typeInto(page, "f-banner", "UNCLASSIFIED — SYNTHETIC EXAMPLE");
    await tabTo(page, "f-review_status"); // no choice yet: Tab lands on the first radio
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // Complete
    assert.equal(await activeId(page), "f-review_status-2");
    await tabToText(page, "Save");
    await press(page, "Enter");

    // 6. Freeze.
    assert.match(await page.content(), /No problems found by OpenSCG/);
    await tabToText(page, "Freeze for approval");
    await press(page, "Enter");
    await axe(page, "freeze");
    await tabToText(page, "Freeze this revision");
    await press(page, "Enter");
    assert.match(page.url(), /\/revisions\/r1\?saved=frozen$/);
    await axe(page, "revision");
    assert.match(await page.content(), /Imprint does not issue guides/);

    // 7. Export with the keyboard.
    await tabToText(page, "Frozen guide (OpenSCG JSON, canonical form)");
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    const bytes = await readFile((await download.path()) as string, "utf8");
    assert.equal(JSON.parse(bytes).lifecycle.state, "candidate");

    assert.deepEqual(outside, [], "no requests may leave the local server");
    assert.deepEqual(cspViolations, []);
  });

  it("stays usable at 320 CSS pixels wide without sideways scrolling", async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const path of ["/"]) {
      await page.goto(s.base + path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 0, `${path} scrolls sideways by ${overflow}px`);
    }
  });
});
