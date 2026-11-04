#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Build a throwaway, SYNTHETIC PKI and a software token for spike SP-03.
#
#   out/root.pem          synthetic root CA (the only trust anchor)
#   out/other-root.pem    an unrelated root, for the wrong-trust-anchor case
#   out/signer.pem        document-signing cert (digitalSignature + nonRepudiation)
#   out/auth.pem          authentication-only cert (digitalSignature only)
#   out/revoked.pem       signing cert that the root has revoked
#   out/rsa-signer.pem    RSA-2048 document-signing cert
#   out/root.crl.pem      CRL from the root listing revoked.pem
#   out/softhsm/          a SoftHSM2 token holding the signer's private key
#
# Nothing here is real. Keys are generated fresh on every run.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf out && mkdir -p out/ca/newcerts out/softhsm
cd out

ec() { openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1" 2>/dev/null; }

# Roots
ec root.key
openssl req -x509 -new -key root.key -sha256 -days 3650 -subj "/CN=SYNTHETIC TEST ROOT CA/O=Imprint Spike" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.pem
ec other-root.key
openssl req -x509 -new -key other-root.key -sha256 -days 3650 -subj "/CN=SYNTHETIC UNRELATED ROOT/O=Imprint Spike" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out other-root.pem

# Minimal CA database so we can issue a CRL
: > ca/index.txt
echo 1000 > ca/serial
echo 1000 > ca/crlnumber
cat > ca.cnf <<CNF
[ ca ]
default_ca = synthetic
[ synthetic ]
dir = ./ca
database = \$dir/index.txt
new_certs_dir = \$dir/newcerts
serial = \$dir/serial
crlnumber = \$dir/crlnumber
certificate = ./root.pem
private_key = ./root.key
default_md = sha256
default_days = 365
default_crl_days = 3650
policy = anything
unique_subject = no
copy_extensions = none
[ anything ]
commonName = supplied
organizationName = optional
[ signing ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
[ auth ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = clientAuth
CNF

issue() { # name, CN, extension section
  ec "$1.key"
  openssl req -new -key "$1.key" -subj "/CN=$2/O=Imprint Spike" -out "$1.csr"
  openssl ca -batch -config ca.cnf -extensions "$3" -in "$1.csr" -out "$1.pem" -notext >/dev/null 2>&1
}
issue signer  "SYNTHETIC OCA SIGNING CERT" signing
issue auth    "SYNTHETIC OCA AUTH CERT"    auth
issue revoked "SYNTHETIC REVOKED SIGNER"   signing
# RSA signing cert: many CAC/PIV signing certificates are RSA.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out rsa-signer.key 2>/dev/null
openssl req -new -key rsa-signer.key -subj "/CN=SYNTHETIC OCA RSA SIGNING CERT/O=Imprint Spike" -out rsa-signer.csr
openssl ca -batch -config ca.cnf -extensions signing -in rsa-signer.csr -out rsa-signer.pem -notext >/dev/null 2>&1
openssl ca -config ca.cnf -revoke revoked.pem >/dev/null 2>&1
openssl ca -config ca.cnf -gencrl -out root.crl.pem >/dev/null 2>&1

# Software token. Stands in for a smart card: the key goes in and is marked
# non-extractable; signing happens inside the token through PKCS#11.
cat > softhsm2.conf <<CNF
directories.tokendir = $(pwd)/softhsm
objectstore.backend = file
log.level = ERROR
CNF
export SOFTHSM2_CONF="$(pwd)/softhsm2.conf"
softhsm2-util --init-token --free --label "SYNTHETIC-CARD" --so-pin 87654321 --pin 123456 >/dev/null
openssl pkcs8 -topk8 -nocrypt -in signer.key -out signer.p8
softhsm2-util --import signer.p8 --token "SYNTHETIC-CARD" --label signer --id 01 --pin 123456 >/dev/null
openssl pkcs8 -topk8 -nocrypt -in rsa-signer.key -out rsa-signer.p8
softhsm2-util --import rsa-signer.p8 --token "SYNTHETIC-CARD" --label rsa-signer --id 02 --pin 123456 >/dev/null
rm signer.p8 rsa-signer.p8
echo "Synthetic PKI and software token ready in $(pwd)"
