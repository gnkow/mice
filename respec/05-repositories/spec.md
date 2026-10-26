Status: ready-for-agent

# 05 — Namespaces, repositories and version browsing (PLAT-REPO)

## Problem Statement

Scientists need to create, browse, merge, rename and transfer repositories with confidence that platform data (access, favorites, metadata, lineage, audit) follows them.

## Solution

Repository lifecycle and browsing through the BFF with dedicated audited actions. Every repository and namespace has a stable Mice id; rename and transfer keep it. Physical oxen names are static (derived from the stable id). Merge with the `maintain` role, signed under GxP strict, is the only way onto the default branch.

## User Stories

1. As a scientist, I want to create a repository in a namespace, so that I can start versioning data.
2. As a scientist, I want to browse branches, commits and files, so that I can see history.
3. As a scientist, I want large listings and previews paged and capped, so that the app stays responsive.
4. As a maintainer, I want to merge a branch, so that work reaches the main line.
5. As a repository admin, I want to rename a repository, so that names stay meaningful.
6. As a repository admin, I want the rename to preserve access, favorites, metadata and lineage, so that nothing is lost.
7. As a repository admin, I want to transfer a repository to another namespace, so that ownership can change.
8. As a destination namespace owner, I want transfer to require my approval, so that repositories are not dumped on me.
9. As a repository admin, I want to archive a repository, so that it is retired while audit and lineage are retained (no hard delete).
10. As an auditor, I want dedicated audit actions for rename and transfer, so that they are not logged as "other".
11. As a user, I want tags on a repository, so that I can organise them (provided by metadata, not a separate feature).
12. As a user, I want a rename failure to leave the original intact, so that errors are recoverable.

## Implementation Decisions

- Stable repository id in PostgreSQL; the oxen name is an attribute.
- Physical oxen repository names are static (physical key = stable id). Rename changes only the display name in the BFF persistence layer, audited as Intent/Outcome; no oxen move, so commit ids never change. Copy-based rename is not needed.
- The BFF translates names for the CLI and clone URLs.
- Merge page plus `maintain` is the gate; no PR product in this spec. No direct writes or pushes on the default branch; the BFF rejects them. The merge carries expected source and target heads and returns 409 on mismatch. Reverts are revert commits only.
- A separate repository tag store is dropped; PLAT-META tags cover it.
- Transfer requires source repo `admin` and destination namespace Owner approval; collaborators are dropped by default behind an access-change diff and explicit confirmation. It is a BFF metadata change (namespace re-pointing) with no oxen move.
- Preview and listing ceilings: text preview 1 MiB, tree page 500, commit page 100; paging is server-side end to end and unpaged requests above the limit are rejected.

## Testing Decisions

- HTTP tests for rename, transfer, archive and cascades; fault-injection tests focus on repository creation and merge, since rename has no multi-step copy.
- Test that authz path map and role enforcement agree.
- Prior art: existing repository API tests.

## Out of Scope

PR-style review, physical rename or move of oxen repositories, hard delete.

## Further Notes

Throttling of heavy copies now only concerns Jobs and uploads.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Identity and naming
- Namespace stable ids are introduced now, in the same migration as repo ids; display names are changeable (Q21).
- Keep oxen repository names static (physical key = stable id); rename only in the BFF persistence layer; throttling of big copies then applies only to Jobs and uploads; confirmed by the owner (Q25, Q2).
- Rename-copy machinery (read-only freeze with size cap, state machine, privileged copy path, manifest-compare grace) is moot; kept only for any future physical move (Q3, Q4, Q5, Q6).
- Creation uses a "creating" state in Postgres via a unique constraint, then oxen create; a two-direction orphan reconciler runs (Q18).

Transfer
- Transfer is a BFF namespace re-pointing with no oxen move; confirm oxen paths do not embed the namespace (Q10).
- Access-change diff with explicit confirmation; default keeps only explicit collaborators (Q8).

Merge gate and history
- No direct writes on the default branch; approval (signature) via merge always required (Q11).
- Pushes to main only through the server merge route; the BFF rejects direct pushes (Q13).
- Merge carries expected source and target heads; 409 on mismatch (Q14).
- Revert commits only everywhere; no branch repointing (Q12).
- Immutable release records (id, commit, signer, time); labels are mutable metadata (Q23).

Browsing
- "N of M" plus full-data summaries; limits: text 1 MiB, tree page 500, commit page 100 (Q15).
- Server-side paging end to end with streaming; unpaged requests above the limit rejected; Postgres index only if needed (Q16).

Retention
- No purge in product; a documented, dual-controlled, audited operator runbook plus pre-commit scanning covers accidental secrets (Q22).

Inherited (not restated): Q1, Q7, Q9, Q17, Q19, Q20, Q24, Q26.

## Conflicts and open risks

- Q2 superseded its own spike answer; Q3, Q4, Q5, Q6 are largely moot. The earlier rename-as-copy text was removed. OVERRODE.
- Q10: confirm oxen paths do not embed the namespace; with static physical keys by stable id this should hold. PENDING.
- Q25: needs CLI and clone-URL translation through the BFF; the 07-cli module must implement it. RISK.
- Original spec said transfer needs destination `write`; 02 Q6 requires destination namespace Owner approval. The spec now follows 02 Q6.
- Q22: no purge conflicts with secrets in history; mitigated only by the operator runbook. RISK.
- Q11 with 04: the merge signer must differ from the author (02 Q1: at least two eligible mergers per repo).
- Q12: no branch repointing means only main is protected globally (02 Q17); force-push or delete of other released branches is unprotected. RISK.
- Static names make the oxen layer opaque to operators; the id-to-name mapping in Postgres is a single point of recovery and needs backup (04 Q16).
