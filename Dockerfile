# SPDX-License-Identifier: AGPL-3.0-only
#
# Imprint container image (R-UDS-01). Built connected; the result runs with no
# network access. The base image is pinned by digest (requirements §7).
#
#   docker build -t ghcr.io/knitli/imprint:0.1.0-dev .
#
# The image runs as a non-root user and works with a read-only root file
# system. It needs two writable mounts: /data (guides) and /tmp (scratch
# space for PDF rendering). Trust anchors and CRLs are mounted at /trust.
#
# Behind a proxy that inspects TLS, pass its CA bundle as a build secret; it is
# used only while building and is not copied into the image:
#
#   docker build --secret id=ca_bundle,src=/path/to/ca.pem \
#     --build-arg HTTPS_PROXY --network host -t ghcr.io/knitli/imprint:0.1.0-dev .

ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts/install-typst.sh scripts/install-typst.sh
# Install production dependencies, then download the pinned Typst and check
# its SHA-256 before unpacking. An optional extra CA bundle is trusted for
# these downloads only.
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/ca_bundle > /tmp/ca.pem; \
      export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle CURL_CA_BUNDLE=/tmp/ca.pem; \
    fi; \
    npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && ./scripts/install-typst.sh \
 && rm -f .tools/*.tar.xz /tmp/ca.pem
COPY src src
COPY public public
COPY templates templates
COPY bin bin
COPY LICENSE README.md ./

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Imprint" \
      org.opencontainers.image.description="Write, check, sign and export security classification guides in the OpenSCG format. Not an official government tool." \
      org.opencontainers.image.source="https://github.com/knitli/imprint" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production \
    IMPRINT_HOST=0.0.0.0 \
    IMPRINT_PORT=8460 \
    IMPRINT_DATA=/data \
    IMPRINT_TRUST_DIR=/trust \
    IMPRINT_TYPST=/app/.tools/typst/typst
WORKDIR /app
COPY --from=build /app /app
# The node user (uid 1000) owns nothing in /app: the code is read-only to it.
RUN mkdir -p /data /trust && chown 1000:1000 /data
USER 1000:1000
EXPOSE 8460
VOLUME ["/data"]
CMD ["node", "src/main.ts"]
