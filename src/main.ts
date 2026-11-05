// SPDX-License-Identifier: AGPL-3.0-only
//
// Start Imprint. Configuration comes from environment variables:
//
//   IMPRINT_MODE           "local" (default) or "demo". Demo accepts only
//                          synthetic guides and keeps data in a temporary folder.
//   IMPRINT_DATA           where guides are stored (default ./imprint-data).
//   IMPRINT_HOST           address to listen on (default 127.0.0.1).
//   IMPRINT_PORT           port (default 8460; 0 picks a free port).
//   IMPRINT_TRUST_DIR      trust anchors, CRLs and policy for verifying
//                          signatures (default <data>/trust). See src/core/trust.ts.
//   IMPRINT_ALLOWED_HOSTS  extra Host header values to accept, comma-separated,
//                          for example the name a cluster gateway uses.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GuideService } from "./core/service.ts";
import { GuideStore } from "./core/store.ts";
import { createImprintServer } from "./web/server.ts";

const demo = process.env.IMPRINT_MODE === "demo";
const dataDir = demo
  ? await mkdtemp(join(tmpdir(), "imprint-demo-"))
  : resolve(process.env.IMPRINT_DATA ?? "imprint-data");
const host = process.env.IMPRINT_HOST ?? "127.0.0.1";
const port = Number(process.env.IMPRINT_PORT ?? 8460);
const allowedHosts = (process.env.IMPRINT_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const store = new GuideStore(dataDir);
await store.init();
const service = new GuideService(store, { demo });
const trustDir = resolve(process.env.IMPRINT_TRUST_DIR ?? join(dataDir, "trust"));
const server = createImprintServer(service, { host, port, demo, allowedHosts, trustDir });

server.listen(port, host, () => {
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  console.log(
    `Imprint ${demo ? "demo " : ""}listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actual}`,
  );
  if (!demo) console.log(`Data folder: ${dataDir}`);
  console.log(`Trust folder: ${trustDir}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
