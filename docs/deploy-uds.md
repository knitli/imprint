# Deploying Imprint on UDS Core

This page is for the people who package and operate Imprint. It covers the container image, the Zarf package, and deployment onto UDS Core (R-UDS-01 to R-UDS-04, decision 0010).

> **Packaging is not an authorization to operate.** A successful deployment is evidence for your Authorizing Official's review, nothing more. Use synthetic data until your organization has authorized the system for real information.

## What you get

| Piece | What it is |
| --- | --- |
| `Dockerfile` | The Imprint image. Node 22 base pinned by digest, the pinned Typst for PDFs, non-root user, works with a read-only root file system. |
| `deploy/zarf/zarf.yaml` | A Zarf package holding the image, a Deployment, a Service, a volume for guides, and a UDS `Package` resource. Zarf adds an SBOM for the image. |
| UDS `Package` resource | The UDS Operator turns it into ingress at `https://imprint.<domain>`, Keycloak SSO enforced by Authservice and limited to one group, and default-deny network policies. Imprint needs no outbound access, so none is allowed. |

The MVP is single-user (decision 0008), so it runs one replica with the `Recreate` strategy. Multi-user operation is a later phase.

## 1. Build the image (connected)

```bash
docker build -t ghcr.io/knitli/imprint:0.1.0-dev .
```

Behind a proxy that inspects TLS, give the build its CA bundle. It is used only during the build and is not copied into the image:

```bash
docker build --secret id=ca_bundle,src=/path/to/ca.pem --build-arg HTTPS_PROXY --network host -t ghcr.io/knitli/imprint:0.1.0-dev .
```

## 2. Build the Zarf package (connected)

```bash
uds zarf package create deploy/zarf --confirm
```

Zarf takes the image from your local Docker if it is not in a registry. The result is one file, `zarf-package-imprint-amd64-0.1.0-dev.tar.zst`, with the image, manifests and SBOM inside.

## 3. Move it

Move the `.tar.zst` file through your approved transfer process. It needs nothing else from the internet at the destination.

## 4. Deploy (disconnected)

On a cluster that already runs UDS Core:

```bash
uds zarf package deploy zarf-package-imprint-amd64-0.1.0-dev.tar.zst --confirm \
  --set DOMAIN=your.domain --set SSO_GROUP="/Your/Imprint Group"
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOMAIN` | `uds.dev` | Base domain of the tenant gateway. Imprint is served at `imprint.<DOMAIN>`. |
| `SSO_GROUP` | `/UDS Core/Admin` | Keycloak group whose members may use Imprint. **Change it for any real deployment.** |
| `DATA_SIZE` | `1Gi` | Size of the volume that holds guides. |
| `MODE` | `local` | `demo` accepts only synthetic guides and keeps nothing after a restart. |

## 5. Add trust material for signature checks

Imprint trusts no signature until you give it trust anchors. Put them in a Secret named `imprint-trust`, with keys named `anchor-*.pem`, `intermediate-*.pem` and `crl-*.pem`, and an optional `policy.json`:

```bash
uds zarf tools kubectl -n imprint create secret generic imprint-trust \
  --from-file=anchor-agency-root.pem=agency-root.pem \
  --from-file=crl-agency-root.pem=agency-root.crl.pem
```

Imprint rereads it on every verification, so a new CRL takes effect without a restart. See [signing.md](signing.md).

## Signing when Imprint runs in a cluster

The cluster cannot reach a card reader on the signer's workstation. Signers use path C or path B from [signing.md](signing.md) on their own workstation, then upload the signature file through the browser. Nothing else changes.

## Operating it

- **Data:** guides live on the `imprint-data` volume. Back up the `imprint` namespace with your platform's backup tooling, and test a restore. Frozen revisions and their signatures are plain files, so a restore can be checked by opening a revision and seeing its signatures verify.
- **Logs:** Imprint logs only start-up lines and the kind of an internal error. It never logs guide text, titles, signatures or PINs.
- **Updates:** deploy a newer package over the old one. The volume and the `imprint-trust` Secret are kept. To roll back, deploy the earlier package.
- **Security settings:** runs as UID 1000, read-only root file system, no Linux capabilities, no privilege escalation, no service account token, RuntimeDefault seccomp. Writable paths: `/data` (volume) and `/tmp` (256 MiB in-memory scratch space for PDF rendering).

## Local test cluster

To try the whole thing on one machine with Docker, using the UDS Core development bundle:

```bash
uds deploy k3d-core-slim-dev:1.15.2 --confirm
```

```bash
uds zarf package deploy zarf-package-imprint-amd64-0.1.0-dev.tar.zst --confirm
```

Then open `https://imprint.uds.dev`. You are sent to Keycloak first. The development bundle's helper creates a test user in `/UDS Core/Admin`; see the UDS Core documentation for "Add Your Own Package".

## What has been tested

| Check | Result |
| --- | --- |
| Image runs with no network, read-only root, no capabilities, non-root (`deploy/smoke-test.sh`, in CI) | Passes |
| Zarf package builds with an SBOM, UDS CLI 0.40.0 / Zarf 0.88.0 (in CI) | Passes |
| Full deployment on UDS Core 1.15.2 `k3d-core-slim-dev` | **Not yet tested.** The development sandbox could not run a nested Kubernetes cluster: it uses cgroup v1, and its container runtime may not set process priorities, so no pod could start, not even CoreDNS. Run the "Local test cluster" steps on a host with cgroup v2 and Docker, or on a real UDS environment. |

Pinned versions: UDS CLI 0.40.0 (bundles Zarf 0.88.0), UDS Core 1.15.2, k3d 5.8.3.

## Licensing

UDS Core and UDS CLI have their own license terms, and Zarf is Apache-2.0. Deploying Imprint separately does not settle every licensing question for your environment; review the actual artifacts you distribute with counsel.
