# 04: Change-control id pattern

**What to build:** A configurable per-namespace change-control id pattern, required on the reason-policy mutation classes and on merge signatures. The id is validated against the pattern and stored on the audit event and signature record.

**Blocked by:** None (can start immediately)

**Status:** done

## Notes

- Header: `X-Mice-Change-Control-Id`. Same mutation classes as reason policy (`mutationNeedsChangeControl` ↔ `mutationNeedsReason`); creates exempt.
- Default pattern: `^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$`; override via namespace settings `changeControlIdPattern`.
- Declared via `/auth/reason` as `changeControlId` for oxen CLI clients.
- Merge signatures (`signatureStore.record` with binding) require `changeControlId`.
- Web reason dialog collects change-control id and retries with the header.

## Acceptance

- [x] Each namespace has a configurable change-control id pattern
- [x] Change-control id required for: validated-branch changes/deletes, destructive actions, privileged settings, revocation, and merge signatures
- [x] Invalid or missing ids are refused before the mutation runs
- [x] Valid ids are stored on the audit event and the signature record
- [x] New data creation is accepted without a change-control id
- [x] HTTP tests cover refuse and accept paths for each required class
