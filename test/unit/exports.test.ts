// SPDX-License-Identifier: AGPL-3.0-only
//
// M-07: JSON, PDF and workbook from one frozen revision expose the same
// identity, carry the same in-scope guidance, and the release manifest's
// hashes match the files. Synthetic data only.
//
// PDF tests need the pinned Typst (scripts/install-typst.sh) and pdftotext.
// CI sets IMPRINT_REQUIRE_TYPST=1 so a missing tool fails instead of skipping.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { compareForLoss, payloadDigest } from "@knitli/openscg";
import JSZip from "jszip";
import { ExportService } from "../../src/core/exports.ts";
import type { GuideService } from "../../src/core/service.ts";
import { buildModel } from "../../src/export/model.ts";
import { renderPdf, TYPST_VERSION, typstVersion } from "../../src/export/pdf.ts";
import { readWorkbook, writeWorkbook } from "../../src/export/xlsx.ts";
import { fixture, fixtureBytes, LANTERN, LANTERN_REVIEWED, tempService } from "../helpers/fixtures.ts";

const run = promisify(execFile);
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const FIXED = new Date("2026-11-05T00:00:00Z");
const typstReady = (await typstVersion()) === TYPST_VERSION;
const pdfSkip = typstReady
  ? false
  : process.env.IMPRINT_REQUIRE_TYPST
    ? false
    : `Typst ${TYPST_VERSION} not installed`;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "imprint-pdftext-"));
  try {
    await writeFile(join(dir, "a.pdf"), bytes);
    // -raw follows the content stream, so each table cell's text stays together.
    const { stdout } = await run("pdftotext", ["-raw", join(dir, "a.pdf"), "-"]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const squash = (s: string) => s.replace(/[\s​]+/g, "");

describe("workbook", () => {
  for (const file of [LANTERN, LANTERN_REVIEWED, "examples/requirements-compilation.json"]) {
    it(`carries every in-scope field of ${file} and loses nothing`, async () => {
      const guide = await fixture(file);
      const back = await readWorkbook(await writeWorkbook(guide, { statusLabel: "TEST", fixedTime: FIXED }));
      assert.deepEqual(compareForLoss(guide, back).items, []);
    });
  }

  it("stores formula-like text as text, never as a formula", async () => {
    const guide = plain(await fixture(LANTERN));
    const hostile = [
      "=1+1",
      "+SUM(A1)",
      "-2+3",
      "@cmd",
      "\t=tab",
      "\r=cr",
      '=HYPERLINK("http://x")',
      "_x0041_ literal",
    ];
    guide.entries = hostile.map((d: string, i: number) => ({
      entry_id: `h${i}`,
      kind: "element",
      description: d,
      level: "U",
    }));
    const bytes = await writeWorkbook(guide, { statusLabel: "TEST", fixedTime: FIXED });
    const zip = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith("xl/worksheets/"))) {
      const xml = await zip.file(name)?.async("string");
      assert.ok(xml && !/<f[ >]/.test(xml), `${name} contains a formula`);
    }
    const back = await readWorkbook(bytes);
    assert.deepEqual(
      back.entries.map((e: { description: string }) => e.description),
      hostile,
    );
  });

  it("gives the same bytes for the same revision", async () => {
    const guide = await fixture(LANTERN);
    const a = await writeWorkbook(guide, { statusLabel: "TEST", fixedTime: FIXED });
    const b = await writeWorkbook(guide, { statusLabel: "TEST", fixedTime: FIXED });
    assert.deepEqual(a, b);
  });
});

describe("PDF", { skip: pdfSkip }, () => {
  it("shows the identity, every entry, the draft label, and stays relative", async () => {
    const guide = await fixture(LANTERN);
    const model = await buildModel(guide, "draft");
    const text = squash(await pdfText(await renderPdf(model, FIXED)));
    const digest = await payloadDigest(guide as never);
    for (const s of [
      guide.guide_id,
      guide.revision_id,
      digest.value,
      "DRAFT/NOTAPPROVED",
      "UNCLASSIFIED—SYNTHETICEXAMPLE",
    ]) {
      assert.ok(text.includes(squash(String(s))), `missing ${s}`);
    }
    for (const e of guide.entries as { entry_id: string; description: string }[]) {
      assert.ok(text.includes(squash(e.entry_id)), `missing entry ${e.entry_id}`);
      assert.ok(text.includes(squash(e.description)), `missing description of ${e.entry_id}`);
    }
    assert.ok(text.includes(squash("25 years after the record containing the information was created")));
  });

  it("is tagged for screen readers, declares its language, and is repeatable", async () => {
    const model = await buildModel(await fixture(LANTERN), "candidate");
    const a = await renderPdf(model, FIXED);
    const b = await renderPdf(model, FIXED);
    assert.deepEqual(a, b, "same input must give the same bytes");
    const raw = Buffer.from(a).toString("latin1");
    assert.match(raw, /\/StructTreeRoot/);
    assert.match(raw, /\/Lang/);
    assert.match(raw, /\/MarkInfo/);
  });

  it("treats guide text as text, not as Typst markup", async () => {
    const guide = plain(await fixture(LANTERN));
    guide.entries[0].description = '#panic("x") *bold* $math$ <label> @ref // not a comment';
    const text = await pdfText(await renderPdf(await buildModel(guide, "draft"), FIXED));
    assert.ok(squash(text).includes(squash('#panic("x") *bold* $math$ <label> @ref // not a comment')));
  });
});

describe("released files of a frozen revision (M-07)", { skip: pdfSkip }, () => {
  let service: GuideService;
  let cleanup: () => Promise<void>;
  let exportsSvc: ExportService;
  let key: string;
  let revision: string;
  before(async () => {
    ({ service, cleanup } = await tempService());
    exportsSvc = new ExportService(service);
    ({ key } = await service.importGuide(await fixtureBytes(LANTERN_REVIEWED)));
    revision = (await service.freeze(key)).revision_id;
  });
  after(() => cleanup());

  it("match each other and the release manifest", async () => {
    const json = await exportsSvc.revisionFile(key, revision, "json");
    const pdf = await exportsSvc.revisionFile(key, revision, "pdf");
    const xlsx = await exportsSvc.revisionFile(key, revision, "xlsx");
    const { manifest } = JSON.parse(
      new TextDecoder().decode((await exportsSvc.revisionFile(key, revision, "manifest")).bytes),
    );

    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    const byRole = Object.fromEntries(
      manifest.files.map((f: { role: string; sha256: string; name: string }) => [f.role, f]),
    );
    assert.equal(byRole["guide-json"].sha256, sha(json.bytes));
    assert.equal(byRole["rendition-pdf"].sha256, sha(pdf.bytes));
    assert.equal(byRole["rendition-xlsx"].sha256, sha(xlsx.bytes));
    assert.equal(byRole["guide-json"].name, json.name);

    const guide = JSON.parse(new TextDecoder().decode(json.bytes));
    const digest = await payloadDigest(guide);
    assert.deepEqual(manifest.payload_digest, digest);
    assert.equal(manifest.revision_id, revision);

    // Same identity in every rendition.
    const text = squash(await pdfText(pdf.bytes));
    for (const s of [guide.guide_id, revision, digest.value]) assert.ok(text.includes(squash(s)));
    const back = await readWorkbook(xlsx.bytes);
    assert.equal(back.guide_id, guide.guide_id);
    assert.equal(back.revision_id, revision);
    // Same in-scope guidance in the workbook as in the JSON.
    assert.deepEqual(compareForLoss(guide, back).items, []);
  });

  it("never change once released", async () => {
    for (const kind of ["pdf", "xlsx", "manifest", "bundle"] as const) {
      const a = await exportsSvc.revisionFile(key, revision, kind);
      const b = await exportsSvc.revisionFile(key, revision, kind);
      assert.deepEqual(a.bytes, b.bytes, kind);
    }
  });

  it("bundle holds every file and the manifest", async () => {
    const zip = await JSZip.loadAsync((await exportsSvc.revisionFile(key, revision, "bundle")).bytes);
    const names = Object.keys(zip.files).sort();
    assert.equal(names.filter((n) => /\.(json|pdf|xlsx)$/.test(n)).length, 4);
    assert.ok(names.includes("release-manifest.json"));
    assert.ok(names.includes("README.txt"));
  });
});
