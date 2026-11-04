// SP-01 scenario driver, shared by both candidates. Starts the server given on
// the command line, then walks the thin slice over HTTP and prints what it saw.
// Usage: node scenario.mjs <cwd> <command...>
import { spawn } from "node:child_process";
const [cwd, ...cmd] = process.argv.slice(2);
const t0 = performance.now();
const child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
const base = await new Promise((resolve, reject) => {
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; const m = buf.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
  child.on("exit", (c) => reject(new Error(`server exited ${c}`)));
});
// "Ready" means the first API call succeeds, not just that a port was printed.
for (;;) {
  try { if ((await fetch(base + "/api/guide")).ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 10));
}
const ready = performance.now() - t0;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const codes = (fs) => fs.map((f) => `${f.code}@${f.pointer}`).sort();
const out = { ready_ms: Math.round(ready) };
out.initial = codes((await call("GET", "/api/findings")).body.findings);
const g = (await call("GET", "/api/guide")).body;
const i = g.entries.findIndex((e) => e.entry_id === "perf-range");
const savedReason = g.entries[i].reason;
out.after_removing_reason = codes((await call("PATCH", "/api/entries/perf-range", { reason: null })).body.findings);
out.freeze_with_error = (await call("POST", "/api/freeze")).status;
await call("PATCH", "/api/entries/perf-range", { reason: savedReason });
out.after_markings_review = codes((await call("POST", "/api/markings-review", { status: "complete" })).body.findings);
const fr = await call("POST", "/api/freeze");
out.freeze = { status: fr.status, digest: fr.body.digest?.value };
child.kill();
console.log(JSON.stringify(out, null, 2));
