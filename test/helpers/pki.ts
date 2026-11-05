// SPDX-License-Identifier: AGPL-3.0-only
//
// A throwaway, SYNTHETIC PKI for signing tests, made with the OpenSSL command
// line (as in spike SP-03). Keys are generated fresh for every test run.
//
//   root          the only trust anchor in trustDir
//   otherRoot     an unrelated root, for the wrong-anchor case
//   signer        EC P-256 document-signing cert (digitalSignature + nonRepudiation)
//   rsaSigner     RSA-2048 document-signing cert
//   auth          authentication-only cert (digitalSignature)
//   revoked       document-signing cert revoked in the root's CRL

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Pki {
  readonly dir: string;
  readonly trustDir: string;
  readonly otherTrustDir: string;
  cert(name: "signer" | "rsaSigner" | "auth" | "revoked"): string;
  key(name: "signer" | "rsaSigner" | "auth" | "revoked"): string;
  /** Detached CMS signature with `openssl cms`, standing in for an approved signing tool. */
  sign(
    name: "signer" | "rsaSigner" | "auth" | "revoked",
    data: Uint8Array,
    form?: "DER" | "PEM",
  ): Promise<Uint8Array>;
  cleanup(): Promise<void>;
}

export async function makePki(): Promise<Pki> {
  const dir = await mkdtemp(join(tmpdir(), "imprint-pki-"));
  const o = (...args: string[]) => run("openssl", args, { cwd: dir });
  const ec = (name: string) =>
    o("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", `${name}.key`);
  await ec("root");
  await o(
    "req",
    "-x509",
    "-new",
    "-key",
    "root.key",
    "-sha256",
    "-days",
    "3650",
    "-subj",
    "/CN=SYNTHETIC TEST ROOT/O=Imprint Tests",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-out",
    "root.pem",
  );
  await ec("other-root");
  await o(
    "req",
    "-x509",
    "-new",
    "-key",
    "other-root.key",
    "-sha256",
    "-days",
    "3650",
    "-subj",
    "/CN=SYNTHETIC OTHER ROOT/O=Imprint Tests",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-out",
    "other-root.pem",
  );
  await mkdir(join(dir, "ca", "newcerts"), { recursive: true });
  await writeFile(join(dir, "ca", "index.txt"), "");
  await writeFile(join(dir, "ca", "serial"), "1000\n");
  await writeFile(join(dir, "ca", "crlnumber"), "1000\n");
  await writeFile(
    join(dir, "ca.cnf"),
    `[ ca ]
default_ca = t
[ t ]
dir = ./ca
database = $dir/index.txt
new_certs_dir = $dir/newcerts
serial = $dir/serial
crlnumber = $dir/crlnumber
certificate = ./root.pem
private_key = ./root.key
default_md = sha256
default_days = 365
default_crl_days = 30
policy = p
unique_subject = no
copy_extensions = none
[ p ]
commonName = supplied
organizationName = optional
[ signing ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
[ auth ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = clientAuth
`,
  );
  const issue = async (name: string, cn: string, ext: string, rsa = false) => {
    if (rsa)
      await o("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", `${name}.key`);
    else await ec(name);
    await o(
      "req",
      "-new",
      "-key",
      `${name}.key`,
      "-subj",
      `/CN=${cn}/O=Imprint Tests`,
      "-out",
      `${name}.csr`,
    );
    await o(
      "ca",
      "-batch",
      "-config",
      "ca.cnf",
      "-extensions",
      ext,
      "-in",
      `${name}.csr`,
      "-out",
      `${name}.pem`,
      "-notext",
    );
  };
  await issue("signer", "SYNTHETIC OCA SIGNER", "signing");
  await issue("rsaSigner", "SYNTHETIC OCA RSA SIGNER", "signing", true);
  await issue("auth", "SYNTHETIC LOGIN ONLY", "auth");
  await issue("revoked", "SYNTHETIC REVOKED SIGNER", "signing");
  await o("ca", "-config", "ca.cnf", "-revoke", "revoked.pem");
  await o("ca", "-config", "ca.cnf", "-gencrl", "-out", "root.crl.pem");

  const trustDir = join(dir, "trust");
  await mkdir(join(trustDir, "anchors"), { recursive: true });
  await mkdir(join(trustDir, "crls"), { recursive: true });
  await writeFile(join(trustDir, "anchors", "root.pem"), await readFile(join(dir, "root.pem")));
  await writeFile(join(trustDir, "crls", "root.crl.pem"), await readFile(join(dir, "root.crl.pem")));
  const otherTrustDir = join(dir, "other-trust");
  await mkdir(join(otherTrustDir, "anchors"), { recursive: true });
  await writeFile(join(otherTrustDir, "anchors", "other.pem"), await readFile(join(dir, "other-root.pem")));

  return {
    dir,
    trustDir,
    otherTrustDir,
    cert: (n) => join(dir, `${n}.pem`),
    key: (n) => join(dir, `${n}.key`),
    async sign(n, data, form = "DER") {
      const input = join(dir, `in-${Date.now()}-${Math.random()}.bin`);
      await writeFile(input, data);
      const { stdout } = await run(
        "openssl",
        [
          "cms",
          "-sign",
          "-binary",
          "-md",
          "sha256",
          "-nosmimecap",
          "-outform",
          form,
          "-in",
          input,
          "-signer",
          join(dir, `${n}.pem`),
          "-inkey",
          join(dir, `${n}.key`),
        ],
        { encoding: "buffer" },
      );
      return new Uint8Array(stdout);
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** True if the SoftHSM2 and OpenSC tools are installed (the decision 0009 acceptance environment). */
export async function hasSoftHsm(): Promise<boolean> {
  try {
    await run("softhsm2-util", ["--version"]);
    await run("pkcs11-tool", ["--help"]).catch((e: { stdout?: string }) => {
      if (!e.stdout) throw e;
    });
    return true;
  } catch {
    return false;
  }
}

export const SOFTHSM_MODULE = process.env.SOFTHSM_MODULE ?? "/usr/lib/softhsm/libsofthsm2.so";
