# 08: Revoke timing and restore rules

**What to build:** Revoking before the merge blocks the merge. A QC Failed commit returns to QC Passed only through a new signature. Revocation does not propagate between commits of a signature. Revoking the signature fails its commits including the merge commit; revoking individual commits leaves the merge commit's status unchanged.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Revoking a merge request before it merges blocks the merge
- [ ] QC Failed returns to QC Passed only via a new signature; history shows both
- [ ] No status propagation between commits of a signature
- [ ] Revoking the whole signature fails its commits, including the merge commit
- [ ] Revoking individual commits leaves the merge commit's status unchanged
- [ ] UI warns on merge commits and descendants that contain QC Failed commits (with repositories/03)
