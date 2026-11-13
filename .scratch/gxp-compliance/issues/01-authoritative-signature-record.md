# 01: Authoritative signature record

**What to build:** The full signature record lives in immudb (append-only) and PostgreSQL holds only a non-authoritative index. The record snapshots printed name, `iss`, `sub` and server time, the meaning "Approved", the IdP evidence and the binding (source head, target head, merge-result SHA-256 manifest digest). Records are never edited or deleted.

**Blocked by:** None (can start immediately)

**Status:** done (store and server events; the merge flow in gxp-compliance/05 supplies the binding and manifest, and no HTTP route exposes the proof yet)

- [x] Each signature writes one immudb record with `esign.created`; failures write `esign.failed`
- [x] The record carries the fields above and a verification proof can be retrieved
- [x] A PostgreSQL index supports lookup by repository, commit and signer, and can be rebuilt from immudb
- [x] The manifest is stored before the signature becomes final
- [x] No API edits or deletes a signature record

## Comments

- **Audit:** holds at store + `POST /auth/sign/execute`; proof only via module seam (no HTTP).
- **Deepen (auto-pick Top):** `GET /auth/sign/:id` + `GET /auth/sign/:id/proof` for record/proof retrieval.
- **Tests:** `signingRecord.test.ts` HTTP get/proof after execute; `signatureStore.test.ts` remains the unit seam.
- **Seams:** HTTP `/auth/sign/:id[/proof]`; module `signatureStore.proof` / `get`.
