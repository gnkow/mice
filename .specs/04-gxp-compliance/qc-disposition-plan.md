# Plan: Commit QC disposition (ADR 0009)

Greenfield. Persist `unset` | `valid` | `invalid` only.

## Slice A — Domain store & rules (auth)

1. Rename `CommitQc` to Unset/Valid/Invalid (`none`→`unset`, drop `marked`/`passed`/`failed` as canonical names).
2. `applyDispositionMap({ repositoryId, map, signatureId, actor })`:
   - refuse Valid if actor authored/co-authored that commit
   - upsert QC + `signatureId`
3. Remove Pin refusal on Invalid (`assertPinAllowed` no-op or delete gate).
4. Open MR: stop writing QC Marked.
5. `completeSignedMerge`: require disposition map covering Unset in range + merge commit; allow Invalid; self-Valid deadlock → 403.
6. `markBranchValidatedUseCase`: require disposition map for all Unset tip-ancestry commits (not silent all-Valid); Approver when Unset remain; self-Valid deadlock.
7. New HTTP: `POST .../commits/disposition` (ad-hoc, write+, signed ceremony, map body).
8. Covering-signature: still via `signatureId` on QC rows.
9. Revoke routes: do not change QC (ledger-only or deprecate status side-effects).

## Slice B — Web UI

1. History: labels Unset / Valid / Invalid; warn on Invalid + descendants (not “revoked”).
2. MR complete / sign panel: disposition table for incoming commits + merge commit; default Valid; submit map with ceremony.
3. Mark-validated: disposition table for Unset tip commits when required.
4. Ad-hoc: disposition controls on commit detail (write+).
5. Copy: ValidatedBranchesSection / BranchesPage — mark signs Unset via map.

## Slice C — Tests

1. applyDispositionMap: Valid self refused; Invalid self allowed; override.
2. Merge complete with mixed Valid/Invalid map; deadlock when Approver must Valid own Unset.
3. Mark-validated requires map; Pin on Invalid allowed.
4. Ad-hoc disposition HTTP: writer non-author OK; author Valid refused.

## Out of scope this pass

- Redesigning signature revoke ledger UX beyond “does not flip QC”
- Entity-versioning QC rows
