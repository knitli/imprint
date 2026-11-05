// SPDX-License-Identifier: AGPL-3.0-only
//
// M-09, M-10, M-14 in the browser: upload a signature for a frozen revision,
// see each verification result in plain words, record the authority review
// with the keyboard, and run axe-core on the revision page at every step.
// Synthetic PKI and data only.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type Browser, chromium, type Page } from "playwright";
import { fixtureBytes, LANTERN_REVIEWED } from "../helpers/fixtures.ts";
import { makePki, type Pki } from "../helpers/pki.ts";
import { startServer } from "../helpers/server.ts";

const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function axe(page: Page, label: string): Promise<void> {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return r.violations.map((v: { id: string }) => v.id);
  });
  assert.deepEqual(violations, [], `axe violations on ${label}`);
}

async function submitBy(page: Page, label: string): Promise<void> {
  const button = page.getByRole("button", { name: label });
  await button.focus();
  const navigated = page.waitForEvent("framenavigated");
  await page.keyboard.press("Enter");
  await navigated;
  await page.waitForLoadState("load");
}

describe("signing workflow in the browser (M-09, M-10, M-14)", () => {
  let browser: Browser;
  let pki: Pki;
  let s: Awaited<ReturnType<typeof startServer>>;
  let page: Page;
  let work: string;

  before(async () => {
    pki = await makePki();
    s = await startServer(false, pki.trustDir);
    browser = await chromium.launch();
    page = await browser.newPage({ acceptDownloads: true });
    work = await mkdtemp(join(tmpdir(), "imprint-e2e-sign-"));
  });
  after(async () => {
    await browser?.close();
    await s?.stop();
    await pki?.cleanup();
    await rm(work, { recursive: true, force: true });
  });

  it("downloads the statement, accepts a signature, shows results and records the review", async () => {
    const { key } = await s.service.importGuide(await fixtureBytes(LANTERN_REVIEWED));
    await s.service.freeze(key);
    await page.goto(`${s.base}/guides/${key}/revisions/2026-r1`);
    await axe(page, "revision before signing");
    assert.match(await page.content(), /No signatures yet/);

    // Download the exact bytes, as a person would.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "approval-statement.bin" }).click(),
    ]);
    const statement = new Uint8Array(await readFile((await download.path()) as string));

    // Sign them with an external tool (OpenSSL stands in for an approved one) and upload.
    const sigPath = join(work, "approval-statement.p7s");
    await writeFile(sigPath, await pki.sign("signer", statement));
    await page.setInputFiles("#f-signature", sigPath);
    await submitBy(page, "Upload signature");
    assert.match(page.url(), /saved=signed$/);
    const html = await page.content();
    assert.match(html, /Signature valid; authority not verified\./);
    assert.match(html, /Chains to a local trust anchor/);
    // A valid signature never makes the guide "approved" on screen (M-10).
    assert.doesNotMatch(
      html,
      /(guide|revision) (is|was|has been) approved|>\s*approved\s*</i,
      "the page must never call the guide approved",
    );
    await axe(page, "revision with a signature");

    // A login-only certificate is stored but shown as not valid, with the reason.
    await writeFile(sigPath, await pki.sign("auth", statement));
    await page.setInputFiles("#f-signature", sigPath);
    await submitBy(page, "Upload signature");
    assert.match(await page.content(), /Not a document-signing certificate/);

    // Record the authority review with the keyboard; a missing name is refused first.
    await page.locator("#f-authority_status").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // Complete
    await submitBy(page, "Save review");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "error-summary");
    await axe(page, "review form with errors");
    await page.locator("#f-authority_reviewed_by").fill("Pat Reviewer (fictional)");
    await page.locator("#f-authority_reviewed_on").fill("2026-11-05");
    await submitBy(page, "Save review");
    assert.match(page.url(), /saved=review$/);
    assert.match(await page.content(), /Signature valid; a human authority review is recorded as complete\./);
    await axe(page, "revision after review");
  });

  it("explains the trust settings", async () => {
    await page.goto(`${s.base}/trust`);
    assert.match(await page.content(), /SYNTHETIC TEST ROOT/);
    await axe(page, "trust settings");
  });
});
