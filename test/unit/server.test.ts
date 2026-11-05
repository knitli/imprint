// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, it, mock } from "node:test";
import { fixtureBytes, LANTERN } from "../helpers/fixtures.ts";
import { post, startServer } from "../helpers/server.ts";

describe("web server", () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  before(async () => {
    s = await startServer();
  });
  after(() => s.stop());

  it("sends a strict Content Security Policy and other protective headers", async () => {
    const res = await fetch(`${s.base}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-(eval|inline)/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("refuses requests for another host name (DNS rebinding)", async () => {
    // fetch() will not let us set Host, so use node:http directly.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const u = new URL(s.base);
      request({ host: u.hostname, port: u.port, path: "/", headers: { host: "attacker.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on("error", reject)
        .end();
    });
    assert.equal(status, 421);
  });

  it("refuses form posts from another site (CSRF)", async () => {
    const cross = await post(
      s.base,
      "/guides",
      { title: "x", classification: "U" },
      { "sec-fetch-site": "cross-site" },
    );
    assert.equal(cross.status, 403);
    const nullOrigin = await fetch(`${s.base}/guides`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" },
      body: "title=x&classification=U",
    });
    assert.equal(nullOrigin.status, 403);
    assert.deepEqual(await s.service.list(), []);
  });

  it("does not serve files outside its asset folders", async () => {
    for (const p of [
      "/assets/uswds/../../../package.json",
      "/assets/uswds/%2e%2e/%2e%2e/package.json",
      "/assets/app.css/../../package.json",
    ]) {
      assert.equal((await fetch(s.base + p)).status, 404, p);
    }
  });

  it("escapes guide text in pages", async () => {
    const res = await post(s.base, "/guides", {
      title: '<img src=x onerror="alert(1)">',
      classification: "U",
      profile: "cnsi-core",
    });
    assert.equal(res.status, 303);
    const page = await (await fetch(s.base + (res.headers.get("location") ?? ""))).text();
    assert.ok(page.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    assert.ok(!page.includes('<img src=x onerror="alert(1)">'));
  });

  it("refuses a bad entry form and shows the errors, keeping what was typed", async () => {
    const created = await post(s.base, "/guides", {
      title: "Form test",
      classification: "U",
      profile: "cnsi-core",
    });
    const guide = created.headers.get("location")?.split("?")[0] ?? "";
    const res = await post(s.base, `${guide}/entries`, {
      entry_id: "e1",
      kind: "element",
      description: "Typed text stays",
      level_mode: "single",
      level: "S",
      declass_kind: "date",
      declass_date: "2026-13-01",
    });
    assert.equal(res.status, 400);
    const page = await res.text();
    assert.match(page, /id="error-summary"/);
    assert.match(page, /href="#f-declass_date"/);
    assert.match(page, /Typed text stays/);
    assert.match(page, /value="2026-13-01"/);
    const ok = await post(s.base, `${guide}/entries`, {
      entry_id: "e1",
      kind: "element",
      description: "Synthetic",
      level_mode: "single",
      level: "S",
      declass_kind: "none",
    });
    assert.equal(ok.status, 303);
    const overview = await (await fetch(s.base + guide)).text();
    assert.match(overview, /OSCG-V010/);
    assert.match(overview, /OSCG-V013/);
  });

  it("imports a file through the upload form", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from(await fixtureBytes(LANTERN))], { type: "application/json" }),
      "lantern.json",
    );
    const res = await fetch(`${s.base}/guides/import`, {
      method: "POST",
      body: form,
      redirect: "manual",
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location") ?? "", /saved=imported/);
  });

  it("never logs guide text, even when something fails", async () => {
    const logged: string[] = [];
    const spies = ["log", "error", "warn", "info"].map((m) =>
      mock.method(console, m as "log", (...a: unknown[]) => {
        logged.push(a.join(" "));
      }),
    );
    try {
      const secret = "SYNTHETIC-CANARY-7731";
      await post(s.base, "/guides", { title: secret, classification: "U", profile: "cnsi-core" });
      await post(s.base, "/guides", { title: secret, classification: "ZZ", profile: "cnsi-core" });
      await fetch(`${s.base}/guides/import`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x", "sec-fetch-site": "same-origin" },
        body: `--x\r\nbroken ${secret}`,
      });
      assert.ok(!logged.some((l) => l.includes(secret)), logged.join("\n"));
    } finally {
      for (const sp of spies) sp.mock.restore();
    }
  });
});

describe("demo server", () => {
  it("refuses guides not marked synthetic (M-13)", async () => {
    const d = await startServer(true);
    try {
      const res = await post(d.base, "/guides", {
        title: "Real?",
        classification: "U",
        profile: "cnsi-core",
      });
      assert.equal(res.status, 400);
      assert.match(await res.text(), /Every guide must be marked synthetic/);
      assert.match(await (await fetch(`${d.base}/`)).text(), /Demo: synthetic data only/);
    } finally {
      await d.stop();
    }
  });
});
