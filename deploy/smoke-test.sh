#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Smoke-test the Imprint image the way UDS runs it: no network at all,
# read-only root file system, non-root, no Linux capabilities, a volume for
# /data and in-memory /tmp. Imports a synthetic guide, freezes it, exports
# every file, restarts, and checks the guide is still there.
#
# Usage: deploy/smoke-test.sh [image]   (default ghcr.io/knitli/imprint:0.1.0-dev)
set -euo pipefail
IMAGE="${1:-ghcr.io/knitli/imprint:0.1.0-dev}"
NAME="imprint-smoke-$$"
VOLUME="imprint-smoke-data-$$"
GUIDE="$(dirname "$0")/../node_modules/@knitli/openscg/conformance/cases/valid-lantern-reviewed.json"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOLUME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" --network none --read-only --tmpfs /tmp:rw,size=64m \
  --cap-drop ALL --security-opt no-new-privileges -v "$VOLUME:/data" \
  -e IMPRINT_HOST=127.0.0.1 "$IMAGE" >/dev/null

wait_ready() {
  for _ in $(seq 1 30); do
    if docker exec "$NAME" node -e 'fetch("http://127.0.0.1:8460/healthz").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))' 2>/dev/null; then return 0; fi
    sleep 1
  done
  docker logs "$NAME"; echo "FAIL: not healthy"; exit 1
}
wait_ready

docker exec -i "$NAME" node -e '
const b = "http://127.0.0.1:8460", h = { "sec-fetch-site": "same-origin" };
(async () => {
  const file = Buffer.concat(await Array.fromAsync(process.stdin));
  const fd = new FormData(); fd.append("file", new Blob([file]), "guide.json");
  const imp = await fetch(b + "/guides/import", { method: "POST", body: fd, redirect: "manual", headers: h });
  if (imp.status !== 303) throw new Error("import " + imp.status);
  const g = imp.headers.get("location").split("?")[0];
  const fr = await fetch(b + g + "/freeze", { method: "POST", redirect: "manual", headers: h });
  if (fr.status !== 303) throw new Error("freeze " + fr.status);
  for (const p of ["guide.json", "guide.pdf", "guide.xlsx", "release-manifest.json", "release.zip"]) {
    const r = await fetch(b + g + "/revisions/2026-r1/" + p);
    const n = (await r.arrayBuffer()).byteLength;
    if (r.status !== 200 || n === 0) throw new Error(p + " " + r.status);
    console.log("ok", p, n, "bytes");
  }
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
' < "$GUIDE"

docker exec "$NAME" sh -c 'if touch /app/should-fail 2>/dev/null; then echo "FAIL: root file system is writable"; exit 1; fi'
docker restart "$NAME" >/dev/null
wait_ready
docker exec "$NAME" node -e 'fetch("http://127.0.0.1:8460/").then(r=>r.text()).then(t=>{ if(!/LANTERN/.test(t)){console.error("FAIL: guide lost after restart");process.exit(1)} console.log("ok guide kept after restart") })'
echo "PASS: image works offline, read-only, non-root"
