#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
//
// imprint-sign: sign an Imprint approval statement (or release manifest) with
// a key on a PKCS#11 token, and write a detached CMS signature (.p7s) to
// upload back into Imprint. Signing path B in decision 0007; spike SP-03.
//
// The token's own tool, OpenSC's pkcs11-tool, does the signing and asks for
// the PIN itself. This program never sees, asks for, stores or logs a PIN or
// a private key. Anything after `--` is passed to pkcs11-tool unchanged, for
// example `-- --slot 1`.
//
// Before writing the file, it verifies its own signature. That catches the
// two silent mistakes SP-03 found: hashing twice, and an RSA signature over a
// bare hash instead of a DigestInfo.
//
// Usage:
//   imprint-sign --module /usr/lib/x86_64-linux-gnu/opensc-pkcs11.so --id 02 \
//                --in approval-statement.bin --out approval-statement.p7s [--cert signer.pem]

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { fromPem, verifyDetached } from "@knitli/openscg";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const run = promisify(execFile);
const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  ecPublicKey: "1.2.840.10045.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.2.840.10045.3.1.34",
};

interface Options {
  module: string;
  id: string;
  input: string;
  output: string;
  cert?: string;
  extra: string[];
}

function usage(message?: string): never {
  if (message) console.error(`imprint-sign: ${message}\n`);
  console.error(
    "Usage: imprint-sign --module <pkcs11 library> --id <key id, hex> --in <file to sign> --out <signature.p7s> [--cert <certificate>] [-- <extra pkcs11-tool options>]",
  );
  process.exit(2);
}

function options(argv: string[]): Options {
  const split = argv.indexOf("--");
  const own = split === -1 ? argv : argv.slice(0, split);
  const extra = split === -1 ? [] : argv.slice(split + 1);
  const { values } = parseArgs({
    args: own,
    options: {
      module: { type: "string" },
      id: { type: "string" },
      in: { type: "string" },
      out: { type: "string" },
      cert: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) usage();
  const module = values.module ?? process.env.IMPRINT_PKCS11_MODULE;
  if (!module) usage("give --module, or set IMPRINT_PKCS11_MODULE");
  if (!values.id || !/^[0-9A-Fa-f]{1,64}$/.test(values.id))
    usage("give --id as the key's hexadecimal ID, for example 02");
  if (!values.in || !values.out) usage("give --in and --out");
  // A PIN on the command line ends up in shell history and process lists.
  // Automated tests with a throwaway SoftHSM token may opt in explicitly.
  if (extra.some((a) => /^--(pin|so-pin|puk)\b/.test(a)) && !process.env.IMPRINT_SIGN_ALLOW_PIN_ARG) {
    usage("do not put a PIN on the command line; pkcs11-tool will ask for it");
  }
  return { module, id: values.id, input: values.in, output: values.out, cert: values.cert, extra };
}

async function pkcs11(opts: Options, args: string[], interactive: boolean): Promise<void> {
  const full = ["--module", opts.module, ...args, ...opts.extra];
  if (interactive) {
    // Inherit the terminal so pkcs11-tool can ask for the PIN itself.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pkcs11-tool", full, {
        stdio: ["inherit", process.stderr, "inherit"],
        timeout: 120_000,
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`pkcs11-tool exited with code ${code}.`)),
      );
    });
  } else {
    await run("pkcs11-tool", full, { timeout: 60_000 });
  }
}

function certificateDer(bytes: Buffer): Uint8Array {
  const text = bytes.toString("latin1");
  if (text.includes("-----BEGIN CERTIFICATE-----")) {
    const [der] = fromPem(text, "CERTIFICATE");
    if (der) return der;
  }
  return new Uint8Array(bytes);
}

async function main(): Promise<void> {
  const opts = options(process.argv.slice(2));
  const work = await mkdtemp(join(tmpdir(), "imprint-sign-"));
  try {
    const data = new Uint8Array(await readFile(opts.input));

    // 1. The signer's certificate: from a file, or read from the token.
    let certDer: Uint8Array;
    if (opts.cert) {
      certDer = certificateDer(await readFile(opts.cert));
    } else {
      const out = join(work, "cert.der");
      await pkcs11(opts, ["--read-object", "--type", "cert", "--id", opts.id, "--output-file", out], false);
      certDer = new Uint8Array(await readFile(out));
    }
    const cert = pkijs.Certificate.fromBER(new Uint8Array(certDer));
    const spki = cert.subjectPublicKeyInfo;
    const keyAlg = spki.algorithm.algorithmId;

    // 2. Pick the hash and how the token is asked to sign.
    let hash: "SHA-256" | "SHA-384" = "SHA-256";
    let importAlg: EcKeyImportParams | RsaHashedImportParams;
    let mechanism: string;
    if (keyAlg === OID.ecPublicKey) {
      const curve = (spki.algorithm.algorithmParams as asn1js.ObjectIdentifier).valueBlock.toString();
      if (curve === OID.p384) hash = "SHA-384";
      else if (curve !== OID.p256) throw new Error("Only P-256 and P-384 EC keys are supported.");
      importAlg = { name: "ECDSA", namedCurve: hash === "SHA-384" ? "P-384" : "P-256" };
      // Cards usually sign a hash we give them (CKM_ECDSA). We hash exactly once.
      mechanism = "ECDSA";
    } else if (keyAlg === OID.rsaEncryption) {
      importAlg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      // The token hashes and wraps the hash in a DigestInfo itself.
      mechanism = "SHA256-RSA-PKCS";
    } else {
      throw new Error("Only EC and RSA keys are supported.");
    }

    // 3. Build the CMS SignedData with signed attributes (OpenSCG spec 9.3).
    //    The token signs only the DER of the signed attributes.
    const md = await crypto.subtle.digest(hash, data);
    const signedData = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: OID.contentType,
                values: [new asn1js.ObjectIdentifier({ value: OID.data })],
              }),
              new pkijs.Attribute({
                type: OID.messageDigest,
                values: [new asn1js.OctetString({ valueHex: md })],
              }),
            ],
          }),
        }),
      ],
      certificates: [cert],
    });

    const signWithToken = async (tbs: Uint8Array): Promise<ArrayBuffer> => {
      const input =
        mechanism === "ECDSA" ? new Uint8Array(await crypto.subtle.digest(hash, new Uint8Array(tbs))) : tbs;
      const inFile = join(work, "tbs.bin");
      const outFile = join(work, "sig.bin");
      await writeFile(inFile, input);
      console.error(
        `Signing with key ${opts.id} on the token (${mechanism}). The token may ask for its PIN.`,
      );
      await pkcs11(
        opts,
        [
          "--login",
          "--sign",
          "--id",
          opts.id,
          "--mechanism",
          mechanism,
          "--signature-format",
          "openssl",
          "--input-file",
          inFile,
          "--output-file",
          outFile,
        ],
        true,
      );
      const sig = new Uint8Array(await readFile(outFile));
      return sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer;
    };

    class TokenEngine extends pkijs.CryptoEngine {
      override async signWithPrivateKey(tbs: BufferSource): Promise<ArrayBuffer> {
        return signWithToken(new Uint8Array(tbs as ArrayBuffer));
      }
    }
    // PKI.js only reads the key's algorithm here. The private key stays on the token.
    const publicKey = await crypto.subtle.importKey("spki", spki.toSchema().toBER(false), importAlg, true, [
      "verify",
    ]);
    await signedData.sign(
      publicKey,
      0,
      hash,
      data,
      new TokenEngine({ name: "token", crypto: globalThis.crypto }),
    );
    const content = new pkijs.ContentInfo({
      contentType: OID.signedData,
      content: signedData.toSchema(true),
    });
    const der = new Uint8Array(content.toSchema().toBER(false));

    // 4. Verify before writing. Trust is not judged here: the certificate stands in as its own anchor.
    const check = await verifyDetached(data, Buffer.from(der).toString("base64"), {
      trustAnchors: [certDer],
      requireNonRepudiation: false,
    });
    if (check.signature !== "valid") {
      throw new Error(
        "The token returned a signature that does not verify. The token may hash differently from what this tool expects; nothing was written.",
      );
    }
    const strict = await verifyDetached(data, Buffer.from(der).toString("base64"), {
      trustAnchors: [certDer],
    });
    if (strict.key_usage !== "permitted") {
      console.error(
        "Warning: this certificate is not marked for document signing (nonRepudiation). Imprint will report it as not permitted.",
      );
    }
    await writeFile(opts.output, der, { flag: "wx" });
    console.error(`Wrote ${opts.output}. Upload it on the revision page in Imprint.`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(`imprint-sign: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
