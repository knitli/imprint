// SPDX-License-Identifier: AGPL-3.0-only
// Check every revision in a store: it opens, it parses strictly, and for a
// frozen revision the stored payload bytes and the recomputed digest both
// match the freeze record.

import { payloadDigest, sha256 } from "@knitli/openscg";

export async function verifyStore(store) {
  const issues = [];
  let revisions = [];
  try {
    revisions = await store.listRevisions();
  } catch (e) {
    return { revisions: 0, frozen: 0, frozenNotOnBranch: 0, issues: [`cannot list revisions: ${e.message}`] };
  }
  let frozen = 0;
  for (const r of revisions) {
    let guide;
    try {
      guide = await store.read(r.id);
    } catch (e) {
      issues.push(`${r.id}: cannot read (${e.code ?? e.message})`);
      continue;
    }
    if (!r.frozen) continue;
    frozen++;
    try {
      const rec = await store.freezeRecord(r.id);
      const now = await payloadDigest(guide);
      if (now.value !== rec.payload_digest.value) issues.push(`${r.id}: content no longer matches frozen digest`);
      const stored = (await sha256(await store.frozenPayload(r.id))).value;
      if (stored !== rec.payload_digest.value) issues.push(`${r.id}: stored payload bytes do not match frozen digest`);
    } catch (e) {
      issues.push(`${r.id}: freeze record or payload unreadable (${e.code ?? e.message})`);
    }
  }
  // Check every freeze record directly as well, so a frozen revision that fell
  // off the branch (or was never listed) is still verified.
  const listed = new Set(revisions.filter((r) => r.frozen).map((r) => r.id));
  let offBranch = 0;
  for (const id of await store.listFreezeRecords()) {
    if (listed.has(id)) continue;
    offBranch++;
    try {
      const rec = await store.freezeRecord(id);
      const stored = (await sha256(await store.frozenPayload(id))).value;
      if (stored !== rec.payload_digest.value) issues.push(`${id}: stored payload bytes do not match frozen digest`);
      const now = await payloadDigest(await store.read(id));
      if (now.value !== rec.payload_digest.value) issues.push(`${id}: content no longer matches frozen digest`);
    } catch (e) {
      issues.push(`${id}: frozen revision not readable (${e.code ?? e.message})`);
    }
  }
  return { revisions: revisions.length, frozen, frozenNotOnBranch: offBranch, issues };
}
