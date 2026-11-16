# 08: Revoke timing and restore rules

**What to build:** Revoking before the merge blocks the merge. A QC Failed commit returns to QC Passed only through a new signature. Revocation does not propagate between commits of a signature. Revoking the signature fails its commits including the merge commit; revoking individual commits leaves the merge commit's status unchanged.

**Blocked by:** 07

**Status:** done

- [x] Revoking a merge request before it merges blocks the merge
- [x] QC Failed returns to QC Passed only via a new signature; history shows both
- [x] No status propagation between commits of a signature
- [x] Revoking the whole signature fails its commits, including the merge commit _(caller passes commit set / heads)_
- [x] Revoking individual commits leaves the merge commit's status unchanged
- [ ] UI warns on merge commits and descendants that contain QC Failed commits (with repositories/03) _(UI → `/deep-ui`)_

## Comments

**Deep-api Close (2026-11-16):** Pre-merge revoke sets MR `blocked`; complete refuses QC Failed commits; `markCommitsQc` skips failed→passed unless `allowFailedToPassed` from signed complete. UI warning deferred to `/deep-ui`.
