// SPDX-License-Identifier: AGPL-3.0-only
//
// The local web server. Plain node:http (spike SP-01); no framework.
//
// Security defaults (requirements §7):
//  - binds to 127.0.0.1 unless configured otherwise;
//  - rejects requests whose Host header is not an allowed host (stops DNS
//    rebinding: a malicious site cannot point its own name at this server);
//  - rejects state-changing requests that come from another site (CSRF);
//  - strict Content Security Policy: no inline scripts, no eval, no outside
//    origins (decision 0004);
//  - never logs request bodies, guide text or titles.

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "@knitli/openscg";
import { payloadDigest } from "@knitli/openscg";
import { ExportService, type RevisionExport } from "../core/exports.ts";
import { type Doc, type GuideService, type Level, MAX_GUIDE_BYTES, ServiceError } from "../core/service.ts";
import { type AuthorityReview, SigningService } from "../core/signing.ts";
import { PdfUnavailable } from "../export/pdf.ts";
import {
  detailsToForm,
  entryToForm,
  type FieldError,
  type Form,
  markingsToForm,
  parseDetailsForm,
  parseEntryForm,
  parseMarkingsForm,
  parseReviewForm,
  parseSectionsForm,
  reviewToForm,
  sectionsToForm,
} from "./forms.ts";
import type { Safe } from "./html.ts";
import {
  detailsPage,
  entryPage,
  freezePage,
  homePage,
  markingsPage,
  messagePage,
  overviewPage,
  type RevisionData,
  revisionPage,
  sectionsPage,
  trustPage,
} from "./pages.ts";
import { layout, type PageOptions } from "./ui.ts";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly demo: boolean;
  /** Extra Host header values to accept, for example the name a cluster ingress uses. */
  readonly allowedHosts: readonly string[];
  /** Folder holding trust anchors, CRLs and policy (see src/core/trust.ts). */
  readonly trustDir: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "..", "public");
// The package does not export package.json; its main entry is dist/js/uswds.min.js.
const USWDS = dirname(dirname(createRequire(import.meta.url).resolve("@uswds/uswds")));
const FORM_LIMIT = 2 * 1024 * 1024;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readForm(req: IncomingMessage): Promise<Form> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded"))
    throw new HttpError(415, "Unexpected form encoding.");
  return new URLSearchParams((await readBody(req, FORM_LIMIT)).toString("utf8"));
}

/** Read one uploaded file from a multipart form, using the platform's own parser. */
async function readUpload(req: IncomingMessage, field: string): Promise<Uint8Array> {
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("multipart/form-data")) throw new HttpError(415, "Unexpected form encoding.");
  const body = await readBody(req, MAX_GUIDE_BYTES + 64 * 1024);
  const data = await new Request("http://local/upload", {
    method: "POST",
    headers: { "content-type": type },
    body: new Uint8Array(body),
  }).formData();
  const file = data.get(field);
  if (!file || typeof file === "string" || file.size === 0)
    throw new HttpError(400, "Choose a file to upload.");
  return new Uint8Array(await file.arrayBuffer());
}

export function createImprintServer(service: GuideService, config: ServerConfig): Server {
  const allowed = new Set<string>(config.allowedHosts.map((h) => h.toLowerCase()));

  function hostAllowed(host: string | undefined, port: number): boolean {
    if (!host) return false;
    const h = host.toLowerCase();
    if (allowed.has(h)) return true;
    return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  }

  function sameOrigin(req: IncomingMessage): boolean {
    // Browsers set Sec-Fetch-Site themselves; a web page cannot forge it.
    const site = req.headers["sec-fetch-site"];
    if (site) return site === "same-origin" || site === "none";
    // Older clients: fall back to comparing Origin with Host.
    const origin = req.headers.origin;
    if (!origin) return true; // not sent by a cross-site page in any current browser
    if (origin === "null") return false;
    try {
      return new URL(origin).host.toLowerCase() === (req.headers.host ?? "").toLowerCase();
    } catch {
      return false;
    }
  }

  const send = (res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") => {
    res.writeHead(status, {
      "content-type": type,
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      // "same-origin", not "no-referrer": with no-referrer, Chromium sends
      // Origin: null on our own form posts.
      "referrer-policy": "same-origin",
      "x-frame-options": "DENY",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "cache-control": "no-store",
    });
    res.end(body);
  };

  const page = (res: ServerResponse, status: number, opts: Omit<PageOptions, "demo">, body: Safe) =>
    send(res, status, layout({ ...opts, demo: config.demo }, body));

  const redirect = (res: ServerResponse, location: string) => {
    res.writeHead(303, { location, "cache-control": "no-store" });
    res.end();
  };

  const download = (
    res: ServerResponse,
    bytes: Uint8Array | string,
    filename: string,
    type = "application/json; charset=utf-8",
  ) => {
    res.writeHead(200, {
      "content-type": type,
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    res.end(bytes);
  };

  async function serveStatic(res: ServerResponse, root: string, rel: string): Promise<void> {
    const path = normalize(join(root, rel));
    if (!path.startsWith(root + sep)) throw new HttpError(404, "Not found.");
    const type = MIME[extname(path)];
    if (!type) throw new HttpError(404, "Not found.");
    const body = await readFile(path).catch(() => {
      throw new HttpError(404, "Not found.");
    });
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  }

  const crumbs = (key: string, title: string) => [
    { href: "/", label: "Guides" },
    { href: `/guides/${key}`, label: title || "Guide" },
  ];

  const exports = new ExportService(service);
  const signing = new SigningService(service, exports, config.trustDir);

  async function revisionData(
    key: string,
    revisionId: string,
    reviewForm?: Form,
    reviewErrors: readonly FieldError[] = [],
  ): Promise<RevisionData> {
    let statementText: string | null = null;
    let statementProblem: string | null = null;
    try {
      statementText = (await signing.statement(key, revisionId)).statement.statement_text;
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
      statementProblem = e.message;
    }
    const { summary } = await signing.trust();
    return {
      statementText,
      statementProblem,
      attestations: await signing.attestations(key, revisionId),
      manifestSignatures: await signing.manifestSignatures(key, revisionId),
      trust: summary,
      reviewForm: reviewForm ?? reviewToForm((await signing.review(key, revisionId)) as unknown as Doc),
      reviewErrors,
    };
  }

  function entryFindings(findings: readonly Finding[], index: number): Finding[] {
    const prefix = `/entries/${index}`;
    return findings.filter((f) => f.pointer === prefix || f.pointer.startsWith(`${prefix}/`));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (req.socket.localPort ?? config.port) as number;
    // Health check for container platforms. It reveals nothing and changes
    // nothing, so it answers any host name: Kubernetes probes use the pod's IP.
    if (req.url === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      const ok = await service.store.keys().then(
        () => true,
        () => false,
      );
      res.writeHead(ok ? 200 : 503, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(ok ? "ok\n" : "storage unavailable\n");
      return;
    }
    if (!hostAllowed(req.headers.host, port))
      throw new HttpError(421, "This server does not answer to that host name.");
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST")
      throw new HttpError(405, "Method not allowed.");
    if (method === "POST" && !sameOrigin(req))
      throw new HttpError(403, "This request came from another site, so it was refused.");

    if (path.startsWith("/assets/uswds/"))
      return serveStatic(res, USWDS, path.slice("/assets/uswds/".length));
    if (path === "/assets/app.css" || path === "/assets/app.js")
      return serveStatic(res, PUBLIC, path.slice("/assets/".length));

    if (path === "/trust" && method === "GET") {
      return page(
        res,
        200,
        { title: "Trust settings", breadcrumbs: [{ href: "/", label: "Guides" }] },
        trustPage((await signing.trust()).summary),
      );
    }
    if (path === "/" && method === "GET") {
      return page(
        res,
        200,
        { title: "Guides" },
        homePage(await service.list(), config.demo, new URLSearchParams(), []),
      );
    }
    if (path === "/guides" && method === "POST") {
      const f = await readForm(req);
      const errors: FieldError[] = [];
      if (!f.get("title")?.trim()) errors.push({ field: "title", message: "Give the guide a title." });
      if (!f.get("classification"))
        errors.push({ field: "classification", message: "Choose the guide's own classification." });
      if (config.demo && f.get("synthetic") !== "on")
        errors.push({ field: "synthetic", message: "This is a demo. Every guide must be marked synthetic." });
      if (errors.length)
        return page(res, 400, { title: "Guides" }, homePage(await service.list(), config.demo, f, errors));
      const key = await service.create({
        title: f.get("title") ?? "",
        classification: (f.get("classification") ?? "") as Level,
        profile: f.get("profile") ?? "cnsi-core",
        synthetic: f.get("synthetic") === "on",
      });
      return redirect(res, `/guides/${key}?saved=created`);
    }
    if (path === "/guides/import" && method === "POST") {
      const result = await service.importGuide(await readUpload(req, "file"));
      return redirect(
        res,
        `/guides/${result.key}?saved=${result.importedAsFrozen ? "imported-frozen" : "imported"}`,
      );
    }

    const m = /^\/guides\/([0-9a-f]{32})(\/.*)?$/.exec(path);
    if (!m) throw new HttpError(404, "Not found.");
    const key = m[1] as string;
    const sub = m[2] ?? "";
    const base = `/guides/${key}`;
    const view = await service.get(key);
    const title = str(view.doc.title);
    const synthetic = view.doc.synthetic === true;
    const flash = FLASH[url.searchParams.get("saved") ?? ""];

    if (sub === "" && method === "GET") {
      return page(
        res,
        200,
        { title: title || "Guide", synthetic, flash, breadcrumbs: [{ href: "/", label: "Guides" }] },
        overviewPage(view),
      );
    }
    if (sub === "/draft.json" && method === "GET") {
      return download(
        res,
        `${JSON.stringify(view.doc, null, 2)}\n`,
        `${str(view.doc.revision_id) || "draft"}.json`,
      );
    }

    if ((sub === "/preview.pdf" || sub === "/preview.xlsx") && method === "GET") {
      const file = await exports.preview(key, sub === "/preview.pdf" ? "pdf" : "xlsx");
      return download(res, file.bytes, file.name, file.type);
    }

    // Simple forms: details, markings, sections.
    const simple: Record<
      string,
      {
        title: string;
        toForm: (d: Doc) => Form;
        parse: (f: Form, d: Doc) => { value: Doc; errors: readonly FieldError[] };
        render: (f: Form, e: readonly FieldError[]) => Safe;
      }
    > = {
      "/details": {
        title: "Guide details",
        toForm: detailsToForm,
        parse: (f, d) => parseDetailsForm(f, d, { demo: config.demo }),
        render: (f, e) => detailsPage(view, f, e, config.demo),
      },
      "/markings": {
        title: "Document markings",
        toForm: markingsToForm,
        parse: parseMarkingsForm,
        render: (f, e) => markingsPage(view, f, e),
      },
      "/sections": {
        title: "Sections",
        toForm: sectionsToForm,
        parse: parseSectionsForm,
        render: (f, e) => sectionsPage(view, f, e),
      },
    };
    const form = simple[sub];
    if (form) {
      const opts = { title: form.title, synthetic, breadcrumbs: crumbs(key, title) };
      if (method === "GET") return page(res, 200, opts, form.render(form.toForm(view.doc), []));
      const f = await readForm(req);
      const parsed = form.parse(f, view.doc);
      if (parsed.errors.length) return page(res, 400, opts, form.render(f, parsed.errors));
      await service.saveDraft(key, parsed.value);
      return redirect(res, `${base}?saved=saved`);
    }

    // Entries
    const entries = arr(view.doc.entries).map(obj);
    if (sub === "/entries/new" && method === "GET") {
      return page(
        res,
        200,
        { title: "Add an entry", synthetic, breadcrumbs: crumbs(key, title) },
        entryPage(view, "new", entryToForm({ kind: "element" }), [], []),
      );
    }
    if (sub === "/entries" && method === "POST") {
      const f = await readForm(req);
      const parsed = parseEntryForm(f, {});
      if (parsed.errors.length) {
        return page(
          res,
          400,
          { title: "Add an entry", synthetic, breadcrumbs: crumbs(key, title) },
          entryPage(view, "new", f, parsed.errors, []),
        );
      }
      await service.saveDraft(key, { ...view.doc, entries: [...entries, parsed.value] });
      return redirect(res, `${base}/entries/${entries.length}?saved=saved`);
    }
    const em = /^\/entries\/(\d{1,5})(\/delete)?$/.exec(sub);
    if (em) {
      const index = Number(em[1]);
      const entry = entries[index];
      if (!entry) throw new HttpError(404, "No such entry.");
      const opts = {
        title: `Entry ${str(entry.entry_id) || index + 1}`,
        synthetic,
        flash,
        breadcrumbs: crumbs(key, title),
      };
      if (em[2]) {
        if (method !== "POST") throw new HttpError(405, "Method not allowed.");
        const f = await readForm(req);
        // Guard against deleting the wrong entry if the list changed in another tab.
        if ((f.get("entry_id") ?? "") !== str(entry.entry_id))
          throw new HttpError(409, "The entry list changed. Reload and try again.");
        await service.saveDraft(key, { ...view.doc, entries: entries.filter((_, i) => i !== index) });
        return redirect(res, `${base}?saved=deleted`);
      }
      if (method === "GET")
        return page(
          res,
          200,
          opts,
          entryPage(view, index, entryToForm(entry), [], entryFindings(view.findings, index)),
        );
      const f = await readForm(req);
      const parsed = parseEntryForm(f, entry);
      if (parsed.errors.length) return page(res, 400, opts, entryPage(view, index, f, parsed.errors, []));
      const next = entries.slice();
      next[index] = parsed.value;
      await service.saveDraft(key, { ...view.doc, entries: next });
      return redirect(res, `${base}/entries/${index}?saved=saved`);
    }

    // Freeze and revisions
    if (sub === "/freeze" && method === "GET") {
      const digest =
        view.approvalReady && !view.frozen
          ? await payloadDigest({
              ...view.doc,
              lifecycle: { ...obj(view.doc.lifecycle), state: "candidate" },
            } as never)
          : null;
      return page(
        res,
        200,
        { title: "Freeze", synthetic, breadcrumbs: crumbs(key, title) },
        freezePage(view, digest),
      );
    }
    if (sub === "/freeze" && method === "POST") {
      const record = await service.freeze(key);
      return redirect(res, `${base}/revisions/${record.revision_id}?saved=frozen`);
    }
    if (sub === "/new-revision" && method === "POST") {
      const f = await readForm(req);
      await service.newRevision(key, (f.get("revision_id") ?? "").trim());
      return redirect(res, `${base}?saved=new-revision`);
    }
    const rm = /^\/revisions\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\/([a-z.-]+))?$/.exec(sub);
    if (rm) {
      const revisionId = rm[1] as string;
      const action = rm[2] ?? "";
      const revBase = `${base}/revisions/${revisionId}`;
      const rev = await service.revision(key, revisionId);
      const revOpts = {
        title: `Revision ${rev.record.revision_id}`,
        synthetic,
        flash,
        breadcrumbs: crumbs(key, title),
      };
      if (method === "GET") {
        if (action === "")
          return page(
            res,
            200,
            revOpts,
            revisionPage(view, rev.record, rev.doc, await revisionData(key, revisionId)),
          );
        const kind = REVISION_FILES[action];
        if (kind) {
          const file = await exports.revisionFile(key, revisionId, kind);
          return download(res, file.bytes, file.name, file.type);
        }
        if (action === "approval-statement.bin") {
          const { bytes } = await signing.statement(key, revisionId);
          return download(res, bytes, `${revisionId}_approval-statement.bin`, "application/octet-stream");
        }
        if (action === "approval-statement.json") {
          const { statement } = await signing.statement(key, revisionId);
          return download(
            res,
            `${JSON.stringify(statement, null, 2)}\n`,
            `${revisionId}_approval-statement.json`,
          );
        }
        if (action === "release-manifest.bin") {
          const { bytes } = await signing.manifest(key, revisionId);
          return download(res, bytes, `${revisionId}_release-manifest.bin`, "application/octet-stream");
        }
        if (action === "signed-guide.json") {
          return download(res, await signing.signedGuide(key, revisionId), `${revisionId}_signed-guide.json`);
        }
      }
      if (method === "POST") {
        if (action === "signatures") {
          const { added } = await signing.addSignature(key, revisionId, await readUpload(req, "signature"));
          return redirect(res, `${revBase}?saved=${added ? "signed" : "signed-again"}`);
        }
        if (action === "manifest-signatures") {
          const { added } = await signing.addManifestSignature(
            key,
            revisionId,
            await readUpload(req, "signature"),
          );
          return redirect(res, `${revBase}?saved=${added ? "manifest-signed" : "signed-again"}`);
        }
        if (action === "review") {
          const f = await readForm(req);
          const parsed = parseReviewForm(f);
          if (parsed.errors.length) {
            return page(
              res,
              400,
              revOpts,
              revisionPage(view, rev.record, rev.doc, await revisionData(key, revisionId, f, parsed.errors)),
            );
          }
          // The form edits the first piece of evidence; keep any others already recorded.
          const existing = (await signing.review(key, revisionId)).evidence ?? [];
          const first = (parsed.value.evidence as AuthorityReview["evidence"]) ?? [];
          const evidence = [...first, ...existing.slice(1)];
          await signing.saveReview(key, revisionId, {
            ...(parsed.value as unknown as AuthorityReview),
            ...(evidence.length ? { evidence } : {}),
          });
          return redirect(res, `${revBase}?saved=review`);
        }
      }
    }
    throw new HttpError(404, "Not found.");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      let status = 500;
      let message =
        "Something went wrong. Nothing was changed by this request unless the page says otherwise.";
      if (err instanceof HttpError) {
        status = err.status;
        message = err.message;
      } else if (err instanceof PdfUnavailable) {
        status = 503;
        message = err.message;
      } else if (err instanceof ServiceError) {
        status = { bad_input: 400, not_found: 404, conflict: 409, not_ready: 409, rejected: 422 }[err.code];
        message = err.message;
      } else {
        // Log the kind of failure only: never request content or guide text.
        console.error(`imprint: internal error (${(err as Error)?.name ?? "unknown"})`);
      }
      send(
        res,
        status,
        layout({ title: "Problem", demo: config.demo }, messagePage("There is a problem", message, "/")),
      );
    });
  });
}

const REVISION_FILES: Record<string, RevisionExport | undefined> = {
  "guide.json": "json",
  "guide.pdf": "pdf",
  "guide.xlsx": "xlsx",
  "release-manifest.json": "manifest",
  "release.zip": "bundle",
};

const FLASH: Record<string, string> = {
  created: "Guide started. Fill in its details, markings and entries.",
  saved: "Saved.",
  deleted: "Entry deleted.",
  imported: "Imported as a draft.",
  "imported-frozen": "Imported. The file was signed, so it is stored as a frozen revision.",
  frozen: "Revision frozen. Its content can no longer change.",
  "new-revision": "New draft revision started. Earlier revisions are unchanged.",
  signed: "Signature stored. Its verification result is shown below.",
  "signed-again": "That signature was already stored.",
  "manifest-signed": "Release manifest signature stored.",
  review: "Authority review saved. It is kept outside the signed content.",
};
