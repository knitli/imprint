// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { html } from "../../src/web/html.ts";

describe("html template", () => {
  it("escapes every interpolated value", () => {
    const hostile = `<script>alert("x")</script>' onmouseover='x`;
    assert.equal(
      html`<p title="${hostile}">${hostile}</p>`.value,
      `<p title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39; onmouseover=&#39;x">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39; onmouseover=&#39;x</p>`,
    );
  });
  it("does not double-escape nested fragments", () => {
    assert.equal(
      html`<ul>${["a&b", "c"].map((x) => html`<li>${x}</li>`)}</ul>`.value,
      "<ul><li>a&amp;b</li><li>c</li></ul>",
    );
  });
});
