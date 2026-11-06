# 02: Merge-result SHA-256 manifest

**What to build:** Before a signature is final, the platform computes a SHA-256 manifest of the merge result (incrementally cached per commit), stores the manifest, and exposes its digest as the binding the signature will commit to. Commit ids remain informational only.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Manifest is computed for the merge result and incrementally cached
- [ ] Manifest is stored before the signature becomes final
- [ ] Digest matches the stored manifest; a mismatch refuses the signature
- [ ] Signing uses the manifest digest in the binding, not oxen commit ids as the authoritative content evidence
