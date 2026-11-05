# 03: Authoritative signature record

**What to build:** The full signature record lives in immudb (append-only) and PostgreSQL holds only a non-authoritative index. The record snapshots printed name, `iss`, `sub` and server time, the meaning "Approved", the IdP evidence and the binding (source head, target head, merge-result SHA-256 manifest digest). Records are never edited or deleted.

**Spec:** `.specs/04-gxp-compliance.md`, `.specs/03-audit.md` (alignment with 04)

**Blocked by:** None

**Status:** done (store and server events; the merge flow in gxp-compliance/01 supplies the binding and manifest, and no HTTP route exposes the proof yet)

## In code today

Evidence is only appended as audit event detail (`auth/src/authentication/signing/signingRoutes.ts`). There is no authoritative record or index.

## Acceptance

- [x] Each signature writes one immudb record with `esign.created`; failures write `esign.failed`
- [x] The record carries the fields above and a verification proof can be retrieved (`signatureStore().proof`)
- [x] A PostgreSQL index supports lookup by repository, commit and signer, and can be rebuilt from immudb
- [x] The manifest is stored before the signature becomes final
- [x] No API edits or deletes a signature record
