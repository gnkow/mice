# 04: Change-control id pattern

**What to build:** A change-control id on the reason-policy mutation classes and on merge signatures. The id is stored on the audit event and signature record. Per-namespace pattern validation was removed (drizzle 0004); the BFF mints `CC-YYYYMMDD-<hex>` when the client omits one.

**Blocked by:** None (can start immediately)

**Status:** done

## Notes

- Header: `X-Mice-Change-Control-Id`. Same mutation classes as reason policy (`mutationNeedsChangeControl` ↔ `mutationNeedsReason`); creates exempt.
- When required and missing: `allocateChangeControlId()` / `resolveChangeControl({ required: true })` mint a server id.
- Declared via `/auth/reason` as `changeControlId` for oxen CLI clients.
- Merge signatures (`signatureStore.record` with binding) mint when absent.
- Web reason dialog notes that a change-control id is assigned automatically.

## Acceptance

- [x] Change-control id present for: update/delete classes, destructive actions, privileged settings, revocation, and merge signatures
- [x] Missing client ids are minted before the mutation runs (not refused)
- [x] Valid client ids are stored on the audit event and the signature record
- [x] New data creation is accepted without a change-control id
- [x] HTTP tests cover mint-when-missing and client-supplied id paths

## Comments

- **Audit:** holds after aligning with drizzle 0004 (pattern column dropped).
- **Deepen (auto-pick Top):** mint-first `allocateChangeControlId` + `resolveChangeControl` seam; wire proxy/guarded; drop dead `changeControlPatternFor`.
- **Tests:** `changeControl.test.ts` unit; `changeControl.api.test.ts` mint + client id on namespace settings.
- **Seams:** module `allocateChangeControlId` / `resolveChangeControl`; HTTP namespace PATCH.
