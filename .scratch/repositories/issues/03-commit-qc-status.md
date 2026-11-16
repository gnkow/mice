# 03: Commit QC status

**What to build:** Per-commit, branch-invariant QC status: None → QC Marked (MR open) → QC Passed (signed merge) → QC Failed (revocation). Pre-merge revoke blocks merge (wired with gxp/07). UI/API can read status per commit.

**Blocked by:** 02 (Merge requests)

**Status:** done

- [x] `commit_qc_status` store keyed by repository id + commit id
- [x] Opening an MR marks commits in range QC Marked
- [x] Successful signed merge marks range (+ merge commit) QC Passed _(store transition; gxp/05 wires the merge complete caller)_
- [x] GET/API returns status without reading the Audit trail as source of truth
- [x] Unit + HTTP tests cover Marked → Passed transitions

## Comments

**Deep-api Close (2026-11-16):** `commitQcStore` + `GET /auth/repos/:ns/:repo/commits/:commitId/qc`; open-MR can pass `commitIds` to mark. Tests: `commitQcStore.test.ts`, HTTP coverage in `mergeRequestRoutes.test.ts`.
