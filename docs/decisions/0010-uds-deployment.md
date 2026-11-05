# 0010: Deploy on UDS Core as one container in a Zarf package

**Status:** Proposed (implemented; the project owner accepts or changes it)  
**Date:** 2026-11-05  
**Requirements:** R-UDS-01 to R-UDS-04, M-12; decision 0009 (UDS at first release)  
**Spike:** SP-09

## What we chose

- **One container image**, built from the repository's `Dockerfile`: Node 22 pinned by digest, the pinned Typst, a non-root user, and a read-only root file system. It needs only `/data` (a volume) and `/tmp` (scratch space) to be writable.
- **One Zarf package** (`deploy/zarf`) with the image, plain manifests and a UDS `Package` resource. No Helm chart: the manifests are short and Zarf templates the few variables.
- **The UDS Operator does the platform work.** It handles ingress on the tenant gateway, Keycloak SSO enforced by Authservice in front of the app and limited to one group, and default-deny network policy. Imprint needs no outbound access, so it gets none. Imprint itself has no login code.
- **One replica, `Recreate` strategy.** The MVP is single-user with file storage (decision 0008). Two pods must never write the same volume.
- **Trust material in a Secret the administrator owns.** The package does not ship one, so an upgrade never overwrites it. Imprint reads a flat layout (`anchor-*.pem`, `crl-*.pem`) because that is how a Secret mounts.
- **A `/healthz` endpoint** that answers any host name. Kubernetes probes use the pod's IP address, which Imprint's host check would otherwise refuse. It reveals nothing and changes nothing.

## What this means

- Example: an Air Force program office that already runs UDS Core deploys one `.tar.zst` file brought across their approved transfer process, sets the domain and the Keycloak group, and creates the trust Secret.
- Signing still happens on the signer's workstation (decision 0007, paths B and C); only the signature file is uploaded.
- **What would change this:** multi-user operation (phase 3) needs shared storage with locking, or a database, and then more than one replica.
