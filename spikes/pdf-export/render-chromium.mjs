// SPDX-License-Identifier: AGPL-3.0-only
// Render the view model as HTML and print it with the preinstalled Playwright
// Chromium. Synthetic data only. No network: the HTML is set inline and uses
// only locally installed fonts.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { model as m } from "./model.mjs";

const require = createRequire("/opt/node-tools/");
const { chromium } = require("playwright");
const out = process.argv[2] ?? "out/chromium.pdf";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.title)}</title>
<style>
 body{font-family:"DejaVu Sans",sans-serif;font-size:10pt}
 table{border-collapse:collapse;width:100%;margin:6pt 0} th,td{border:0.5pt solid #000;padding:3pt;vertical-align:top;text-align:left}
 thead{display:table-header-group} tr{break-inside:avoid}
 .draft{border:1.5pt solid #c00;padding:6pt;font-weight:bold}
 .wm{position:fixed;top:40%;left:5%;transform:rotate(-35deg);font-size:54pt;color:rgba(200,0,0,.2);font-weight:bold;z-index:-1}
</style></head><body>
${m.draft ? `<div class="wm" aria-hidden="true">DRAFT / NOT APPROVED</div><p class="draft">DRAFT / NOT APPROVED. This is not an issued guide. It has open review items.</p>` : ""}
<p><strong>Overall classification of this document: ${esc(m.banner)}</strong></p>
<h1>${esc(m.title)}</h1>
<table><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead><tbody>
${[["Guide ID", m.guide_id], ["Revision", m.revision_id], ["Payload digest", m.digest], ["Issuing organization", m.issuing_organization], ["Original classification authority", m.oca], ["Point of contact", m.poc], ["Issued", m.issued], ["Next review due", m.next_review_due]].map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}
</tbody></table>
<h2>Introduction</h2><p>${esc(m.introduction)}</p>
<h2>Open review items</h2><ul>${m.open_findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
${m.sections.map((s) => `<h2>${esc(s.title)}</h2><table><thead><tr><th scope="col">Portion</th><th scope="col">Information</th><th scope="col">Level</th><th scope="col">Reason</th><th scope="col">Declassify</th></tr></thead><tbody>
${s.entries.map((e) => `<tr><td>${esc(e.portion)}</td><td>${esc(e.description)}${e.kind === "compilation" ? `<br><em>Compilation of ${esc(e.references)} when: ${esc(e.condition)}</em>` : ""}${e.controls !== "None" ? `<br>Controls: ${esc(e.controls)}` : ""}</td><td>${esc(e.level)}</td><td>${esc(e.reason)}</td><td>${esc(e.declassification)}</td></tr>`).join("")}
</tbody></table>`).join("")}
</body></html>`;

const banner = (extra = "") => `<div style="width:100%;text-align:center;font-family:'DejaVu Sans';font-size:10pt;font-weight:bold">${esc(m.banner)}${extra}</div>`;
const browser = await chromium.launch();
const page = await browser.newPage();
// Fail loudly if anything tries to reach the network.
await page.route("**/*", (r) => { console.error("BLOCKED request", r.request().url()); r.abort(); });
await page.setContent(html, { waitUntil: "load" });
await writeFile("out/chromium.html", html);
await page.pdf({
  path: out, format: "Letter", tagged: true, outline: true, printBackground: true,
  displayHeaderFooter: true,
  margin: { top: "2.4cm", bottom: "2.6cm", left: "2cm", right: "2cm" },
  headerTemplate: banner(),
  footerTemplate: banner(`<div style="font-size:7pt;font-weight:normal">${esc(m.guide_id)} · revision ${esc(m.revision_id)} · ${esc(m.digest)} · page <span class="pageNumber"></span></div>`),
});
await browser.close();
console.log("wrote", out, "with", require("playwright/package.json").version);
