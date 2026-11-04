# Addendum: Git versioning and Defense Unicorns UDS

**Status:** Supporting analysis; November 4, 2026. OpenSCG and Imprint are the adopted project names. The updated companion [requirements document](requirements.md) takes precedence where this analysis differs.

## Recommendation

Design the canonical guide and its signed approval so they can live in a Git repository, and run a focused `isomorphic-git` proof of concept. If it handles the required local persistence and recovery cleanly, use Git for MVP revision history behind the existing authoring UI; users should not need to know Git. Otherwise keep immutable canonical snapshots for the first release and add Git interoperability. Do not select a required Git server or Kubernetes cluster for a standalone authoring demo.

Treat UDS Core as a serious deployment target for disconnected installations, especially where the host organization already operates it. The initial package supports the single-user MVP; shared multi-user operation follows the later management phase. Publish an Imprint UDS/Zarf package shortly after the MVP and validate it against a representative compatible UDS test environment. Preserve a small standalone development/demo path. The deployment choice and guide-versioning choice are independent.

## 1. What Git buys

- Each saved revision can have a content-addressed commit, parent history and a human-readable diff; branches can support parallel proposed changes and rollback by a new revision.
- Later, an enclave-local Git host could support reviews and protected publication branches, while the SCG application provides a purpose-built review experience.
- Git is a widely understood synchronization and import/export format. Keep JSON Schema and signing contracts independent of Git so other implementations do not need the same library or host.

### Proposed workflow

1. Save a draft as deterministic structured JSON, with stable guide/entry identifiers; commit with a machine-generated or user-provided description. Display a guide-aware diff, not only raw JSON. An ordinary draft commit is not approval.
2. Freeze the exact candidate and validate its complete payload. Review the candidate's human-readable rendering and diff. Identify the candidate by guide ID, revision, Git commit ID and independently computed SHA-256 canonical content digest.
3. OCA personally signs the approval statement using the existing approved credential and supported browser/workstation signing interface. Store a detached CMS attestation binding the approved canonical digest, revision and purpose. Certificate verification, authority verification and issuance remain distinct. Store the attestation in a later commit or separate release record to avoid a circular reference to a commit that contains its own signature; it identifies the earlier candidate commit and content digest. The attestation must bind the candidate content, not merely a mutable branch name.
4. Before issuing, recheck that the actual published content matches the signed digest, the claimed signature verifies under local trust policy and the authorized authority review is complete. Moving a tag/branch, merging, rewriting history or changing content does not carry approval forward automatically. Show any differing candidate as needing fresh approval.
5. Retain issued artifacts and an independent, access-controlled publication/audit record. Git branches and tags are mutable and a repository administrator can rewrite history; integrity and rollback detection require protected controls and independent verification, not an assumption that Git is immutable. A policy-approved correction or supersession creates a new traceable revision.

A conventional Git commit/tag signature may be useful for developer provenance; it is not automatically a PIV/CAC-based OCA approval or proof of the signer's delegation. The approval record should remain independently verifiable by a consumer that does not use Git.

### `isomorphic-git` fit

[isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) is MIT-licensed and runs in Node and browsers. It uses a pluggable filesystem; browser use needs an appropriate filesystem implementation. Its [documented `onSign` interface](https://isomorphic-git.org/docs/en/onSign.html) concerns PGP signing and does not provide a built-in CAC/PIV CMS signing workflow. Keep the existing detached-approval design.

**Reliability and security:** The upstream project warns that its LightningFS browser filesystem can reorder writes on a crash; `flush()` is a mitigation, not a substitute for a recovery and durability test. Browser persistence can also be cleared or evicted. Remote Git operations may require same-origin support or an approved in-boundary proxy; never route sensitive guide data through a public proxy. The project notes that it is maintained by a small volunteer team. Pin a reviewed version and assess security advisories, hostile repositories, path/ref handling, dependencies and native-Git interoperability before production use. [Upstream documentation](https://github.com/isomorphic-git/isomorphic-git).

**Confidentiality:** Full Git history, deleted content, commit messages, author names, refs, clones, caches and backups can contain sensitive information. Git provides no encryption, fine-grained authorization or classification enforcement by itself. Use repositories and clones within an approved security domain, separated wherever different guide access rules require it; do not mix guides of different access scope merely for convenience. Encrypt and protect all replicas as required; establish records-retention and incident response procedures. Removing a file from the latest revision does not erase its history or other clones.

### Acceptance criteria for a Git-backed MVP

- A synthetic guide survives create, edit, commit, close/reopen, and restore; native Git independently reads the result. Crash/interruption tests exercise the chosen filesystem and documented recovery path.
- A guide-aware diff identifies added, removed and modified entries, conditions, caveats, reasons and declassification instructions; binary/generated exports are regenerated rather than treated as source of truth.
- The verification path rejects a changed canonical payload, unsigned content, replayed attestation for another revision and publication of a different post-merge tree. Repointing a branch or tag is detected against the independent publication record.
- A signed revision can be verified from its exported JSON and detached approval without requiring a Git service or the browser application. Verify certificate trust and independent authority status separately.
- A repository imported or shared from outside the trust boundary receives resource limits, path/ref validation and applicable malware/security checks; no external network or public proxy is required by default.
- Access, backups, logs and replicas respect the relevant security boundary; approved retention and restore procedures cover both repository and attestation/publication records.

## 2. Defense Unicorns: where each component fits

| Component | Role | Relevance |
|---|---|---|
| [UDS Base / UDS Core](https://defenseunicorns.com/platform/uds-platform/) | UDS Base is the open foundation; Core supplies a Kubernetes runtime with common identity, network, policy, logging and operational services. | Strong candidate where an authorized host already has UDS. Installing and operating a cluster solely to preview one guide adds substantial infrastructure. |
| [UDS CLI](https://github.com/defenseunicorns/uds-cli) | Builds and orchestrates UDS bundles and deployment tasks. | Use to create a repeatable deployment package for a compatible target, not as the guide's approval mechanism. |
| [Zarf](https://docs.zarf.dev/) | Packages dependencies for repeatable disconnected deployment, especially Kubernetes workloads. | A practical air-gap packaging candidate. Zarf also supports host actions outside a cluster; establish whether that mode offers value for the standalone distribution instead of assuming the full runtime is needed. |
| [Pepr](https://github.com/defenseunicorns/pepr) | Kubernetes admission and controller framework. | Reuse the UDS platform's policies when deployed there. It is not a stand-alone general SCG policy or OCA-approval engine. |

UDS can reduce work on platform controls and help assemble authorization evidence, but the designated Authorizing Official decides whether the configured system may operate. A package, hardened baseline, or an existing platform's authorization does not automatically authorize the SCG app, its data flows, or a new deployment. [UDS security documentation](https://docs.defenseunicorns.com/core/v1-14/concepts/platform/security/) and [UDS FAQ](https://defenseunicorns.com/platform/uds-platform/).

Licensing and packaging need review: Defense Unicorns describes UDS Base as AGPL-3.0; Core and CLI repositories specify their own dual-license terms, while Zarf and Pepr use Apache-2.0. Separate deployment of Imprint does not itself settle every license question; its license is undecided. Evaluate the actual artifacts, modifications and distribution with counsel. Vendor-provided hardened/FIPS images, detailed ATO artifacts and support can depend on commercial terms; the [product comparison](https://defenseunicorns.com/pricing/) distinguishes Base and paid tiers. Individual functional layers may have separate access requirements; verify current availability before planning around them. See [functional layers](https://docs.defenseunicorns.com/core/v1-15/concepts/platform/functional-layers/).

### Deployment acceptance criteria and spike

1. **Baseline:** retain a documented local/synthetic demo path without Kubernetes or external services.
2. **Target selection:** choose a representative, authorized existing UDS environment and record platform version, flavor, actual image availability, access agreements, cluster capacity, identity integration and applicable control baseline. Do not infer hardware or policy suitability from a local demo.
3. **Packaging:** build an application image and UDS/Zarf package with versioned dependencies and SBOM; demonstrate connected preparation, integrity verification, controlled transfer and disconnected installation on the selected test cluster. Use only synthetic data during the spike.
4. **Integration:** test identity mapping, least-privilege service access, network policy, persistent storage, audit events without guide-content leakage, restore and a versioned update/rollback. Identify which platform controls are inherited, shared or application-owned.
5. **Authorization evidence:** document the configured boundary, data flows, residual controls, cryptographic requirements and AO review path. Treat a successful technical test as evidence for review, not an ATO.

The [production prerequisites](https://docs.defenseunicorns.com/core/v1-14/getting-started/production/prerequisites/) show why this is an operational choice: UDS needs a real Kubernetes environment, storage, networking and platform services. Costs differ substantially between deploying into an existing managed UDS cluster and running a new cluster for the app.

## 3. Open decisions

- Does the intended first adopter already have an approved Kubernetes/UDS environment, or does the project need to support a single workstation first?
- Are multi-author review and guide history essential for the first release, or is local single-author revision history enough? This determines how much Git and host integration pays for itself immediately.
- Which versioned and maintained Git library, filesystem and storage strategy pass the durability, hostile-input and interoperability checks? `isomorphic-git` is a candidate, not an automatic dependency.
- Who owns authority verification, publication records, repository access, retention and backups in each deployment?
