// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from "node:net";
import { createImprintServer } from "../../src/web/server.ts";
import { tempService } from "./fixtures.ts";

export async function startServer(demo = false) {
  const t = await tempService(demo);
  const server = createImprintServer(t.service, { host: "127.0.0.1", port: 0, demo, allowedHosts: [] });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ...t,
    base,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await t.cleanup();
    },
  };
}

/** Post a form the way a browser does from one of Imprint's own pages. */
export function post(
  base: string,
  path: string,
  fields: Record<string, string | string[]>,
  headers: Record<string, string> = {},
) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}
