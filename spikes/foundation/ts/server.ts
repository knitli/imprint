// SPDX-License-Identifier: AGPL-3.0-only
// SP-01 candidate 1: the thin slice in TypeScript, on node:http with no web
// framework. Load LANTERN, edit an entry, show findings by field, freeze, show
// the digest. Synthetic data only. Not product code.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  approvalText, canonicalize, isApprovalReady, parseStrict, payloadDigest, validate, type Guide,
} from "@knitli/openscg";

const pkg = dirname(createRequire(import.meta.url).resolve("@knitli/openscg/package.json"));
const dataDir = process.env.IMPRINT_DATA ?? join(process.cwd(), "data");
let guide = parseStrict(await readFile(join(pkg, "examples/synthetic-lantern.json"))) as Guide;

const MAX_BODY = 1 << 20;
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(c);
  }
  return parseStrict(new Uint8Array(Buffer.concat(chunks)));
}
const json = (res: ServerResponse, code: number, v: unknown) =>
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(v));

const EDITABLE = new Set(["description", "level", "reason", "declassification"]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/guide") return json(res, 200, guide);
    if (req.method === "GET" && url.pathname === "/api/findings") {
      const findings = validate(guide);
      return json(res, 200, { approval_ready: isApprovalReady(findings), findings });
    }
    const m = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
    if (req.method === "PATCH" && m) {
      const patch = (await body(req)) as Record<string, unknown>;
      const entry = (guide.entries as Array<Record<string, unknown>>).find((e) => e.entry_id === m[1]);
      if (!entry) return json(res, 404, { error: "no such entry" });
      for (const [k, v] of Object.entries(patch)) {
        if (!EDITABLE.has(k)) return json(res, 400, { error: `field ${k} is not editable here` });
        if (v === null) delete entry[k]; else entry[k] = v;
      }
      return json(res, 200, { findings: validate(guide) });
    }
    if (req.method === "POST" && url.pathname === "/api/markings-review") {
      // Records that an authorized person reviewed the guide's own markings.
      const { status } = (await body(req)) as { status: string };
      (guide as any).document_markings.review = { status };
      return json(res, 200, { findings: validate(guide) });
    }
    if (req.method === "POST" && url.pathname === "/api/freeze") {
      const findings = validate(guide);
      // A draft may be saved with errors, but it cannot be frozen for approval.
      if (!isApprovalReady(findings)) return json(res, 409, { error: "not approval-ready", findings });
      const digest = await payloadDigest(guide);
      await mkdir(dataDir, { recursive: true });
      const file = join(dataDir, `${guide.revision_id}.${digest.value.slice(0, 12)}.json`);
      await writeFile(file, canonicalize(guide), { flag: "wx" });
      return json(res, 201, { file, digest, statement_text: approvalText(guide, digest) });
    }
    if (req.method === "GET" && url.pathname === "/") {
      return res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'",
      }).end(await readFile(new URL("./index.html", import.meta.url)));
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      return res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(new URL("./app.js", import.meta.url)));
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    // Never echo request content back or log it: it may be guide text.
    json(res, 400, { error: "bad request" });
  }
});

const port = Number(process.env.PORT ?? 0);
server.listen(port, "127.0.0.1", () => {
  const a = server.address();
  console.log(`listening on http://127.0.0.1:${typeof a === "object" && a ? a.port : port}`);
});
