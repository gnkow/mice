# 03: Commit QC status

**What to build:** Every commit has a QC status: None, QC Marked (a merge request for approval is open), QC Passed (after the signed merge) or QC Failed (after revocation). The status belongs to the commit and is the same on every branch; non-validated branches inherit it and need no signature. The UI shows the status and warns when a merge commit or descendant contains QC Failed commits. A merge commit keeps its own status.

**Spec:** `.specs/05-repositories.md`, `.specs/04-gxp-compliance.md`

**Blocked by:** repositories/02, gxp-compliance/01

**Status:** ready-for-agent

## Acceptance

- [ ] Status is stored per commit and read identically from any branch
- [ ] Opening a merge request sets QC Marked; a signed merge sets QC Passed; closing a request unmarks it
- [ ] Revocation (gxp-compliance 04) sets QC Failed; no status propagates to other commits
- [ ] Browse, history and lineage views show the status; a "contains QC Failed commits" warning appears on affected merge commits and descendants
- [ ] New Pins are blocked on QC Failed commits
- [ ] All status changes are audited and versioned
