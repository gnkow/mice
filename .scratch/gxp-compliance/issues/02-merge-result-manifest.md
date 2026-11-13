# 02: Merge-result SHA-256 manifest

**What to build:** Before a signature is final, the platform computes a SHA-256 manifest of the merge result (incrementally cached per commit), stores the manifest, and exposes its digest as the binding the signature will commit to. Commit ids remain informational only.

**Blocked by:** 01

**Status:** done

## Notes

- Pure builder: `buildMergeManifest` → canonical `path hash\n` lines, digest = SHA-256 of that text.
- `manifestForCommit` lists the tree (SHA-256 of file bytes via materialize), caches per namespace/repo/commit.
- `signatureStore.record` already stores the manifest before the signature and refuses digest mismatch; binding uses `manifestDigest` (heads are tips only).
- Merge flow in ticket 05 wires this into the signing ceremony.

## Acceptance

- [x] Manifest is computed for the merge result and incrementally cached
- [x] Manifest is stored before the signature becomes final
- [x] Digest matches the stored manifest; a mismatch refuses the signature
- [x] Signing uses the manifest digest in the binding, not oxen commit ids as the authoritative content evidence

## Comments

- **Audit:** holds at `buildMergeManifest` / `manifestForCommit` / store record; integration thin until ticket 05 wires merge HTTP.
- **Deepen (auto-pick Top):** extract `mergeResultBinding` so digest-first binding is one seam for ticket 05.
- **Tests:** `mergeManifest.test.ts` binding unit; `signatureStore.test.ts` records via that helper (manifest before signature).
- **Seams:** module `mergeResultBinding` + `signatureStore.record`.
