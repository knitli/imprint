// SPDX-License-Identifier: AGPL-3.0-only
//
// The local trust policy (requirements §6, M-09, M-12). An administrator puts
// files in one folder; Imprint reads them each time it verifies, so a change
// takes effect without a restart. Nothing is fetched from the network:
// revocation lists are supplied offline.
//
//   <trust>/anchors/        trust anchor certificates (PEM or DER)
//   <trust>/intermediates/  extra intermediate certificates (PEM or DER)
//   <trust>/crls/           certificate revocation lists (PEM or DER)
//   <trust>/policy.json     optional: {"unknown_revocation": "fail" | "accept",
//                                      "require_non_repudiation": true | false}
//
// The same files can also sit directly in <trust>/ with a prefix, which is how
// a Kubernetes Secret or ConfigMap mounts them (one flat folder):
//   anchor-*.pem, intermediate-*.pem, crl-*.pem
//
// With no anchors, nothing is trusted (OpenSCG spec 9.4: there is no default trust).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fromPem, type TrustPolicy } from "@knitli/openscg";
import * as pkijs from "pkijs";

export interface TrustSummary {
  readonly dir: string;
  readonly anchors: readonly { subject: string; notAfter: string }[];
  readonly intermediates: number;
  readonly crls: number;
  readonly unknownRevocation: "fail" | "accept";
  readonly requireNonRepudiation: boolean;
  readonly problems: readonly string[];
}

const MAX_FILE = 1024 * 1024;

async function readObjects(
  dir: string,
  label: string,
  problems: string[],
  prefix = "",
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const names = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    // Skip hidden names, including the ..data links Kubernetes adds to mounted Secrets.
    if (name.startsWith(".") || !name.startsWith(prefix) || entry.isDirectory()) continue;
    const bytes = await readFile(join(dir, name)).catch(() => null);
    if (!bytes || bytes.length > MAX_FILE) {
      problems.push(`${name}: could not be read, or is larger than 1 MB.`);
      continue;
    }
    const text = bytes.toString("latin1");
    if (text.includes("-----BEGIN")) {
      const found = fromPem(text, label);
      if (!found.length) problems.push(`${name}: contains no "${label}" block.`);
      out.push(...found);
    } else {
      out.push(new Uint8Array(bytes));
    }
  }
  return out;
}

function describe(der: Uint8Array): { subject: string; notAfter: string } | null {
  try {
    const cert = pkijs.Certificate.fromBER(new Uint8Array(der));
    const subject = cert.subject.typesAndValues
      .map((tv) => `${oidName(tv.type)}=${tv.value.valueBlock.value}`)
      .join(", ");
    return { subject, notAfter: cert.notAfter.value.toISOString() };
  } catch {
    return null;
  }
}

const OIDS: Record<string, string> = { "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C" };
const oidName = (oid: string) => OIDS[oid] ?? oid;

export async function loadTrust(dir: string): Promise<{ policy: TrustPolicy; summary: TrustSummary }> {
  const problems: string[] = [];
  const anchors = [
    ...(await readObjects(join(dir, "anchors"), "CERTIFICATE", problems)),
    ...(await readObjects(dir, "CERTIFICATE", problems, "anchor-")),
  ];
  const intermediates = [
    ...(await readObjects(join(dir, "intermediates"), "CERTIFICATE", problems)),
    ...(await readObjects(dir, "CERTIFICATE", problems, "intermediate-")),
  ];
  const crls = [
    ...(await readObjects(join(dir, "crls"), "X509 CRL", problems)),
    ...(await readObjects(dir, "X509 CRL", problems, "crl-")),
  ];
  let unknownRevocation: "fail" | "accept" = "fail";
  let requireNonRepudiation = true;
  const raw = await readFile(join(dir, "policy.json"), "utf8").catch(() => null);
  if (raw !== null) {
    try {
      const p = JSON.parse(raw) as { unknown_revocation?: unknown; require_non_repudiation?: unknown };
      if (p.unknown_revocation === "accept") unknownRevocation = "accept";
      else if (p.unknown_revocation !== undefined && p.unknown_revocation !== "fail") {
        problems.push('policy.json: unknown_revocation must be "fail" or "accept". Using "fail".');
      }
      if (p.require_non_repudiation === false) requireNonRepudiation = false;
    } catch {
      problems.push("policy.json: not valid JSON. Using the defaults.");
    }
  }
  const described = anchors.map(describe);
  described.forEach((d, i) => {
    if (!d) problems.push(`Trust anchor ${i + 1} is not a readable certificate.`);
  });
  return {
    policy: { trustAnchors: anchors, intermediates, crls, unknownRevocation, requireNonRepudiation },
    summary: {
      dir,
      anchors: described.filter((d): d is { subject: string; notAfter: string } => d !== null),
      intermediates: intermediates.length,
      crls: crls.length,
      unknownRevocation,
      requireNonRepudiation,
      problems,
    },
  };
}
