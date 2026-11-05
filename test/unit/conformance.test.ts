// SPDX-License-Identifier: AGPL-3.0-only
//
// M-11: Imprint's own checking path passes the OpenSCG 0.1.0 validation
// conformance cases (spec/conformance.md section 4), using the published files.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isApprovalReady, parseStrict, StrictParseError, validateStructure } from "@knitli/openscg";
import { fixture, fixtureBytes, tempService } from "../helpers/fixtures.ts";

interface Case {
  id: string;
  file: string;
  expected: {
    parse_error?: string;
    structure?: string;
    approval_ready?: boolean;
    findings?: { code: string; pointer: string }[];
  };
}

const manifest = (await fixture("conformance/manifest.json")) as unknown as {
  suite_version: string;
  cases: Case[];
};

describe(`OpenSCG validation conformance suite ${manifest.suite_version} through GuideService`, async () => {
  const { service, cleanup } = await tempService();
  for (const c of manifest.cases) {
    it(c.id, async () => {
      const bytes = await fixtureBytes(join("conformance", c.file));
      let doc: Record<string, unknown>;
      try {
        doc = parseStrict(bytes) as Record<string, unknown>;
      } catch (e) {
        assert.ok(e instanceof StrictParseError);
        assert.equal(e.code, c.expected.parse_error);
        return;
      }
      assert.equal(c.expected.parse_error, undefined);
      const structure = validateStructure(doc).length === 0 ? "valid" : "invalid";
      assert.equal(structure, c.expected.structure);
      const findings = service.findings(doc);
      assert.equal(isApprovalReady(findings), c.expected.approval_ready);
      if (structure === "valid" && c.expected.findings) {
        const key = (f: { code: string; pointer: string }) => `${f.code} ${f.pointer}`;
        assert.deepEqual(findings.map(key).sort(), c.expected.findings.map(key).sort());
      }
    });
  }
  it("cleans up", () => cleanup());
});
