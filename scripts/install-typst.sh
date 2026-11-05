#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Install the pinned Typst command-line tool into ./.tools/typst/ (decision 0005).
# The archive's SHA-256 is checked before anything is unpacked.
#
# For an offline install, put the archive in ./.tools/ first (copied through
# your approved transfer process); the script then uses it without downloading.
set -euo pipefail
VERSION="0.15.0"
ARCHIVE="typst-x86_64-unknown-linux-musl.tar.xz"
SHA256="59b207df01be2dab9f13e80f73d04d7ff8273ffd46b3dd1b9eef5c60f3eeabea"
URL="https://github.com/typst/typst/releases/download/v${VERSION}/${ARCHIVE}"

cd "$(dirname "$0")/.."
mkdir -p .tools
if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "This script installs the Linux x86_64 build. On other systems, install Typst ${VERSION} yourself and set IMPRINT_TYPST." >&2
  exit 1
fi
if [ ! -f ".tools/${ARCHIVE}" ]; then
  curl --fail --location --silent --show-error --output ".tools/${ARCHIVE}" "${URL}"
fi
echo "${SHA256}  .tools/${ARCHIVE}" | sha256sum --check --quiet
rm -rf .tools/typst
mkdir -p .tools/typst
tar -xJf ".tools/${ARCHIVE}" -C .tools/typst --strip-components=1
.tools/typst/typst --version
