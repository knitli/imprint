// SPDX-License-Identifier: AGPL-3.0-only
// Render the view model with pdfmake (pure JavaScript). Synthetic data only.
import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { model as m } from "./model.mjs";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const D = "/usr/share/fonts/truetype/dejavu/";
const printer = new PdfPrinter({
  DejaVu: { normal: D + "DejaVuSans.ttf", bold: D + "DejaVuSans-Bold.ttf", italics: D + "DejaVuSans.ttf", bolditalics: D + "DejaVuSans-Bold.ttf" /* no oblique installed here */ },
});
const out = process.argv[2] ?? "out/pdfmake.pdf";
const row = (k, v) => [{ text: k, bold: true }, v];
const doc = {
  info: { title: m.title, author: m.issuing_organization, creationDate: new Date("2026-11-04T00:00:00Z") },
  defaultStyle: { font: "DejaVu", fontSize: 9 },
  pageSize: "LETTER",
  pageMargins: [56, 70, 56, 76],
  watermark: m.draft ? { text: "DRAFT / NOT APPROVED", color: "red", opacity: 0.15, bold: true } : undefined,
  header: { text: m.banner, alignment: "center", bold: true, margin: [0, 30, 0, 0] },
  footer: (p) => ({ stack: [{ text: m.banner, bold: true }, { text: `${m.guide_id} · revision ${m.revision_id} · ${m.digest} · page ${p}`, fontSize: 6 }], alignment: "center", margin: [0, 20, 0, 0] }),
  content: [
    m.draft ? { table: { widths: ["*"], body: [[{ text: "DRAFT / NOT APPROVED. This is not an issued guide. It has open review items.", bold: true }]] }, margin: [0, 0, 0, 8] } : "",
    { text: `Overall classification of this document: ${m.banner}`, bold: true, margin: [0, 0, 0, 6] },
    { text: m.title, fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
    { table: { headerRows: 1, widths: ["auto", "*"], body: [[{ text: "Field", bold: true }, { text: "Value", bold: true }],
      row("Guide ID", m.guide_id), row("Revision", m.revision_id), row("Payload digest", m.digest), row("Issuing organization", m.issuing_organization),
      row("Original classification authority", m.oca), row("Point of contact", m.poc), row("Issued", m.issued), row("Next review due", m.next_review_due)] } },
    { text: "Introduction", fontSize: 12, bold: true, margin: [0, 10, 0, 4] }, m.introduction,
    { text: "Open review items", fontSize: 12, bold: true, margin: [0, 10, 0, 4] }, { ul: m.open_findings },
    ...m.sections.flatMap((s) => [
      { text: s.title, fontSize: 12, bold: true, margin: [0, 10, 0, 4] },
      { table: { headerRows: 1, widths: ["auto", "*", "auto", "*", "*"], body: [
        ["Portion", "Information", "Level", "Reason", "Declassify"].map((t) => ({ text: t, bold: true })),
        ...s.entries.map((e) => [e.portion,
          { text: [e.description, e.kind === "compilation" ? { text: `\nCompilation of ${e.references} when: ${e.condition}`, italics: true } : "", e.controls !== "None" ? `\nControls: ${e.controls}` : ""] },
          e.level, e.reason, e.declassification]),
      ] } },
    ]),
  ],
};
const pdf = printer.createPdfKitDocument(doc);
pdf.pipe(createWriteStream(out)).on("finish", () => console.log("wrote", out));
pdf.end();
