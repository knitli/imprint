// SPDX-License-Identifier: AGPL-3.0-only
//
// Signing and verification of a frozen revision (M-09, M-10; decisions 0007,
// 0009). Imprint never holds a key or a PIN. It hands out the exact bytes to
// sign, accepts a detached CMS signature made elsewhere (an approved signing
// tool, or the imprint-sign helper with a PKCS#11 token), and verifies it only
// with OpenSCG under the local trust policy.
//
// Four things stay separate (requirements §7, last bullet):
//   - the signature's technical result (binding, signature, algorithm, key usage),
//   - its trust result (path to a trust anchor, validity, revocation),
//   - the human authority review (recorded by a person, never inferred),
//   - issuance, which is an act of the organization and is never recorded here.

import {
  type ApprovalStatement,
  ATTESTATION_FORMAT,
  type Attestation,
  approvalStatementBytes,
  buildApprovalStatement,
  fromBase64,
  fromPem,
  type ManifestVerification,
  type ReleaseManifest,
  releaseManifestBytes,
  type SignedReleaseManifest,
  toBase64,
  type VerificationReport,
  verifyAttestation,
  verifyDetached,
  verifyReleaseManifest,
} from "@knitli/openscg";
import type { ExportService } from "./exports.ts";
import { type Doc, type GuideService, ServiceError, signatureId } from "./service.ts";
import { loadTrust, type TrustSummary } from "./trust.ts";

export const REVIEW_STATUSES = ["not_started", "pending", "complete", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The OpenSCG `authority_review` object (spec 4.7). */
export interface AuthorityReview {
  readonly status: ReviewStatus;
  readonly reviewed_by?: string;
  readonly reviewed_on?: string;
  readonly evidence?: readonly { kind?: string; reference: string; date?: string; uri?: string }[];
  readonly notes?: string;
}

export interface AttestationView {
  readonly id: string;
  readonly attestation: Attestation;
  readonly report: VerificationReport;
}

export interface ManifestSignatureView {
  readonly id: string;
  readonly signed: SignedReleaseManifest;
  readonly report: ManifestVerification;
}

const MAX_SIGNATURE_BYTES = 256 * 1024;

const idOf = signatureId;

/**
 * Read an uploaded detached signature: DER, PEM ("PKCS7" or "CMS"), or base64
 * text. Returns base64 of the DER, the form OpenSCG stores.
 */
export function readSignature(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new ServiceError("bad_input", "The signature file is empty.");
  if (bytes.byteLength > MAX_SIGNATURE_BYTES)
    throw new ServiceError("bad_input", "The signature file is too large.");
  if (bytes[0] === 0x30) return toBase64(bytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  for (const label of ["PKCS7", "CMS"]) {
    const [der] = fromPem(text, label);
    if (der) return toBase64(der);
  }
  const compact = text.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    try {
      const der = fromBase64(compact);
      if (der[0] === 0x30) return toBase64(der);
    } catch {
      // fall through to the error below
    }
  }
  throw new ServiceError(
    "bad_input",
    "This is not a detached CMS signature (.p7s) in DER, PEM or base64 form.",
  );
}

export class SigningService {
  readonly guides: GuideService;
  readonly exports: ExportService;
  readonly trustDir: string;

  constructor(guides: GuideService, exports: ExportService, trustDir: string) {
    this.guides = guides;
    this.exports = exports;
    this.trustDir = trustDir;
  }

  trust(): Promise<{ summary: TrustSummary; policy: Awaited<ReturnType<typeof loadTrust>>["policy"] }> {
    return loadTrust(this.trustDir);
  }

  private async frozen(key: string, revisionId: string): Promise<Doc> {
    return (await this.guides.revision(key, revisionId)).doc;
  }

  /** The approval statement for a frozen revision and the exact bytes to sign (spec 9.1, 9.2). */
  async statement(
    key: string,
    revisionId: string,
  ): Promise<{ statement: ApprovalStatement; bytes: Uint8Array }> {
    const doc = await this.frozen(key, revisionId);
    const statement = await buildApprovalStatement(doc as never).catch(() => {
      throw new ServiceError(
        "not_ready",
        "This revision names no expected signer, so there is no approval statement to sign. Add the expected signer in the guide details of a new revision.",
      );
    });
    return { statement, bytes: approvalStatementBytes(statement) };
  }

  async review(key: string, revisionId: string): Promise<AuthorityReview> {
    const raw = await this.guides.store.readReview(key, revisionId);
    return raw ? (JSON.parse(raw) as AuthorityReview) : { status: "not_started" };
  }

  /** Record a person's review of the signer's claimed authority. Never inferred from a signature. */
  async saveReview(key: string, revisionId: string, review: AuthorityReview): Promise<void> {
    await this.frozen(key, revisionId);
    if (!REVIEW_STATUSES.includes(review.status))
      throw new ServiceError("bad_input", "Choose a review status.");
    await this.guides.store.writeReview(key, revisionId, `${JSON.stringify(review, null, 2)}\n`);
  }

  /** The frozen guide with its review attached, as the verifier must see it. */
  private async guideForVerify(key: string, revisionId: string): Promise<Doc> {
    return { ...(await this.frozen(key, revisionId)), review: await this.review(key, revisionId) };
  }

  /**
   * Store an attestation. It is kept only if it describes this exact revision
   * and its signature is mathematically valid. Trust is judged later, under the
   * policy in force when someone looks, because anchors and CRLs change.
   */
  async addAttestation(
    key: string,
    revisionId: string,
    attestation: Attestation,
  ): Promise<{ id: string; added: boolean }> {
    const guide = await this.guideForVerify(key, revisionId);
    const check = await verifyAttestation(guide as never, attestation, { trustAnchors: [] });
    if (check.binding !== "ok") {
      throw new ServiceError(
        "rejected",
        "This signature is for different content: it does not match this revision, so it was not stored.",
      );
    }
    if (check.signature !== "valid") {
      throw new ServiceError(
        "rejected",
        check.signature === "malformed"
          ? "This signature file could not be read as a detached CMS signature."
          : "This signature does not verify over this revision's approval statement. Check that the signing tool signed approval-statement.bin itself, without changing or hashing it first.",
      );
    }
    const id = idOf(attestation.signature);
    const added = await this.guides.store.addSigned(
      key,
      revisionId,
      "attestations",
      id,
      `${JSON.stringify(attestation, null, 2)}\n`,
    );
    return { id, added };
  }

  /** Path C: a detached signature over approval-statement.bin, made by any approved tool. */
  async addSignature(
    key: string,
    revisionId: string,
    upload: Uint8Array,
  ): Promise<{ id: string; added: boolean }> {
    const signature = readSignature(upload);
    const { statement } = await this.statement(key, revisionId);
    return this.addAttestation(key, revisionId, { format: ATTESTATION_FORMAT, statement, signature });
  }

  async attestations(key: string, revisionId: string): Promise<AttestationView[]> {
    const guide = await this.guideForVerify(key, revisionId);
    const { policy } = await this.trust();
    const out: AttestationView[] = [];
    for (const { id, json } of await this.guides.store.listSigned(key, revisionId, "attestations")) {
      const attestation = JSON.parse(json) as Attestation;
      out.push({ id, attestation, report: await verifyAttestation(guide as never, attestation, policy) });
    }
    return out;
  }

  /** The guide with its attestations and review, as one OpenSCG file. */
  async signedGuide(key: string, revisionId: string): Promise<Uint8Array> {
    const guide = await this.guideForVerify(key, revisionId);
    const atts = (await this.guides.store.listSigned(key, revisionId, "attestations")).map((a) =>
      JSON.parse(a.json),
    );
    return new TextEncoder().encode(`${JSON.stringify({ ...guide, attestations: atts }, null, 2)}\n`);
  }

  // ---- Release manifest signatures (spec 10.3) ------------------------------

  async manifest(key: string, revisionId: string): Promise<{ manifest: ReleaseManifest; bytes: Uint8Array }> {
    const manifest = await this.exports.manifest(key, revisionId);
    return { manifest, bytes: releaseManifestBytes(manifest) };
  }

  async addManifestSignature(
    key: string,
    revisionId: string,
    upload: Uint8Array,
  ): Promise<{ id: string; added: boolean }> {
    const signature = readSignature(upload);
    const { manifest, bytes } = await this.manifest(key, revisionId);
    const check = await verifyDetached(bytes, signature, { trustAnchors: [] });
    if (check.signature !== "valid") {
      throw new ServiceError(
        "rejected",
        "This signature does not verify over the current release manifest. Sign release-manifest.bin exactly as downloaded.",
      );
    }
    const signed: SignedReleaseManifest = { manifest, signature };
    const id = idOf(signature);
    const added = await this.guides.store.addSigned(
      key,
      revisionId,
      "manifest-signatures",
      id,
      `${JSON.stringify(signed, null, 2)}\n`,
    );
    return { id, added };
  }

  async manifestSignatures(key: string, revisionId: string): Promise<ManifestSignatureView[]> {
    const guide = await this.frozen(key, revisionId);
    const { policy } = await this.trust();
    const files = await this.exports.releaseFiles(key, revisionId);
    const out: ManifestSignatureView[] = [];
    for (const { id, json } of await this.guides.store.listSigned(key, revisionId, "manifest-signatures")) {
      const signed = JSON.parse(json) as SignedReleaseManifest;
      out.push({ id, signed, report: await verifyReleaseManifest(guide as never, signed, files, policy) });
    }
    return out;
  }
}

/** What to tell people about one attestation (OpenSCG spec 9.4, "What to show people"). */
export function headline(report: VerificationReport, policyAcceptsUnknown: boolean): string {
  if (!report.technically_valid) return "Signature not valid under this system's trust policy.";
  const unknownNote =
    report.revocation === "unknown" && policyAcceptsUnknown
      ? " Revocation status is unknown; the local policy accepts that."
      : "";
  switch (report.authority) {
    case "review_complete":
      return `Signature valid; a human authority review is recorded as complete.${unknownNote}`;
    case "review_rejected":
      return `Signature valid; the recorded authority review rejected the signer's authority.${unknownNote}`;
    default:
      return `Signature valid; authority not verified.${unknownNote}`;
  }
}
