// SPDX-FileCopyrightText: 2026 Knitli Inc.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Tiny local server for spike SP-07. Serves out/ with a strict Content Security
// Policy, and offers POST /api/validate so validation can run outside the page.
// Binds to 127.0.0.1 only. Synthetic data only.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseStrict, validate } from "@knitli/openscg";

const ROOT = new URL("./out/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
};

// script-src 'self' with no 'unsafe-eval'. ?csp=relaxed adds 'unsafe-eval' only
// so the test can show that eval is the one thing the strict policy blocks.
function csp(relaxed) {
  return [
    "default-src 'none'",
    `script-src 'self'${relaxed ? " 'unsafe-eval'" : ""}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const MAX_BODY = 1024 * 1024;

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = {
      "content-security-policy": csp(url.searchParams.get("csp") === "relaxed"),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    if (url.pathname === "/api/validate" && req.method === "POST") {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) { res.writeHead(413, headers).end(); return; }
        chunks.push(c);
      }
      try {
        const doc = parseStrict(new Uint8Array(Buffer.concat(chunks)));
        res.writeHead(200, { ...headers, "content-type": "application/json" });
        res.end(JSON.stringify(validate(doc)));
      } catch (e) {
        res.writeHead(400, { ...headers, "content-type": "application/json" });
        res.end(JSON.stringify([{ code: e.code ?? "PARSE", severity: "error", pointer: "", message: e.message }]));
      }
      return;
    }
    const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(ROOT)) { res.writeHead(403, headers).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { ...headers, "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, headers).end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startServer(Number(process.env.PORT ?? 8077));
  console.log(`http://127.0.0.1:${s.address().port}/  (Ctrl+C to stop)`);
}
