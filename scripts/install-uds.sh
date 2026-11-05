#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Install the pinned UDS CLI (which bundles Zarf) into ./.tools/uds after a
# SHA-256 check. Used to build the Zarf package (docs/deploy-uds.md).
set -euo pipefail
VERSION="v0.40.0"
ASSET="uds-cli_${VERSION}_Linux_amd64"
SHA256="11ca1691d458958d76c4ab80718f33c8dc43d584c81ae25e4be698fc007f0e96"
cd "$(dirname "$0")/.."
mkdir -p .tools
if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "This script installs the Linux x86_64 build. Install UDS CLI ${VERSION} yourself on other systems." >&2
  exit 1
fi
if [ ! -f ".tools/${ASSET}" ]; then
  curl --fail --location --silent --show-error --output ".tools/${ASSET}" \
    "https://github.com/defenseunicorns/uds-cli/releases/download/${VERSION}/${ASSET}"
fi
echo "${SHA256}  .tools/${ASSET}" | sha256sum --check --quiet
install -m 0755 ".tools/${ASSET}" .tools/uds
.tools/uds version
