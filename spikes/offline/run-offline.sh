#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# SP-06: prove the SP-01 TypeScript slice needs no network.
#   Test 1  run the whole slice in a network namespace with no route out
#   Test 2  record every connect()/bind() the server and driver make
# Needs Linux with unprivileged user namespaces, Node 22 and strace.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ts="$here/../foundation/ts"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
cd "$ts"

echo "Test 1: no network at all (only loopback is up)"
rm -rf data
unshare -rn sh -c "python3 -I '$here/lo_up.py' && \
  python3 -I -c 'import socket
try: socket.create_connection((\"1.1.1.1\", 443), timeout=3); print(\"  outbound: REACHABLE (test invalid)\"); raise SystemExit(1)
except OSError as e: print(\"  outbound:\", e)' && \
  node ../scenario.mjs . node --experimental-strip-types --no-warnings server.ts" | grep -E 'outbound|"status"|digest' | sed 's/^/  /'

echo "Test 2: every connect() and bind() during the slice"
rm -rf data
strace -f -qq -e trace=connect,bind -o "$log" node ../scenario.mjs . node --experimental-strip-types --no-warnings server.ts >/dev/null
grep -oE 'sa_family=AF_[A-Z0-9]+[^}]*' "$log" | sed -E 's/sin_port=htons\([0-9]+\)/sin_port=*/' | sort | uniq -c | sed 's/^/  /'
if grep -E 'sa_family=AF_INET6?' "$log" | grep -vqE '127\.0\.0\.1|::1'; then
  echo "FAIL: a non-loopback address was contacted"; exit 1
fi
echo "PASS: only loopback addresses were used"
rm -rf data
