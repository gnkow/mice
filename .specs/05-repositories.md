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
4. As an approver, I want to review and sign a merge request, so that work reaches the validated main line.
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
- Merge request page plus the `approver` role is the gate (04); no separate PR product. The default branch is validated from creation and starts empty; other branches opt in, and marking or unmarking is a signed, reasoned action. Nobody (including Owners and admins) commits, force-pushes or deletes a validated branch directly; the BFF rejects every direct write, push, pointer move and branch delete, and all writes (small-file commit, chunked upload, zip/URL import, lineage corrections) reach it only through a merge request. Templates enter the empty default branch by a signed merge request, no unsigned seed.
- Merging into a validated branch needs a signature by one `approver` (Owner-assignable, audited) who authored or co-authored no commit in the merged range; the repositories module enforces this. The signature binds source head, target head and merge-result manifest digest; the merge returns 409 on head mismatch and the MR goes stale if the target moves (author re-syncs, approval restarts, no auto-rebase). The MR stays unapproved until an approver exists. Merges into non-validated branches need no signature. Reverts are revert commits only.
- Commit QC status (None, QC Marked when an MR is open, QC Passed after the signed merge, QC Failed after revocation) is per commit and branch-invariant; non-validated branches inherit it. Any approver can revoke commits or a whole signature (reason, step-up); revoking before merge blocks the merge. The UI shows status per commit and warns on merge commits and descendants containing QC Failed commits. Signatures are indexed by repository for revocation visibility.
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

## Alignment with 04 (2026-11-05)

- Gate is the `approver` role, not `maintain`; Q11's bypass is closed for every validated branch (no direct writes by anyone, including Owners/admins), and Q13 (local merge then push) is rejected the same way.
- Default branch is validated from creation, empty at start; templates arrive by signed merge request.
- Signature binds source head, target head, manifest digest; stale MR on target move (supersedes the Q14 head-only binding).
- Commit QC status per commit as above; revocation by any approver blocks pre-merge and never propagates.
- Superseded where conflicting: Q11 options/recommendation, Q13, Q14, decisions-log rows on "maintain" gate and "main protected globally"; 02 Q1 two-mergers rule no longer applies.

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
- Q11 with 04: the merge signer is an `approver` who authored no commit in the merged range (04); the two-mergers rule is dropped.
- Q12: no branch repointing means only main is protected globally (02 Q17); force-push or delete of other released branches is unprotected. RISK.
- Static names make the oxen layer opaque to operators; the id-to-name mapping in Postgres is a single point of recovery and needs backup (04 Q16).

---

# Open Questions


Status: ready-for-agent, but the central design (stable repository id, rename as copy+delete, transfer, merge as review gate) is unbuilt and unverified against oxen-server. Today every store (access, favorites, metadata, lineage) is keyed on the namespace/repo name; no stable id exists, and rename/transfer are only classified as "other".
Biggest risks: copy+delete may change commit ids and silently break Pins, lineage and signatures; a write-role user can bypass the "maintain merge gate"; delete and transfer can destroy or leak regulated records; large repositories make rename an hours-long, non-atomic operation.

## Q1 [Impl] The stable repository id does not exist yet. How is it introduced into every store?
AuthZ, favorites, metadata, lineage, jobs and audit all reference repositories by `namespace/repo` text today. Introducing an id means a migration of every table, every cached reference and the web URLs, while oxen itself only knows the name. The spec says "use the id" but not how the id is resolved on each request across N instances.
Example: A Job definition stores `genomics/assay-7`; after a rename to `genomics/assay-7-v2` the Job still launches against the old name and fails, or worse, against a new repository that reused the old name.
Options: (a) id column everywhere plus a name-to-id resolver cached with short TTL, names kept only for display (clean, large migration); (b) keep names and add an alias table (cheaper, perpetual ambiguity); (c) id for new references only.
Recommendation: (a), with a one-time backfill and a test that no store accepts a name as a foreign key.
Challenges: "Mice gets a stable repository id ... AuthZ, favorites, metadata, lineage and audit references use it".

## Q2 [Domain] Does copy+delete preserve commit ids? If not, what do signatures and Pins mean?
Commit ids in oxen derive from content, parent and commit metadata. A copy done by cloning and pushing may preserve them, but a copy done through any API that replays commits will not; the plan marks this "to be verified". If ids change, every Pin, lineage edge, audit `{base, head}` and e-signature binding that cites a commit id points at nothing.
Example: Job J-881 ran Pinned to commit 4f2a. After rename the same history has commit 91bc; the Pin cannot be resolved and the signature "Approved merge 4f2a" appears to reference a nonexistent record.
Options: (a) verify in a spike first and make "ids preserved" a hard acceptance test; otherwise disallow rename; (b) build an old-to-new commit alias table as a permanent record (complex, shifts trust to the table); (c) drop rename in favour of "create new and archive old".
Recommendation: (a), blocking the epic until proven; fall back to (c).
Challenges: "Open detail: whether copy preserves commit ids must be verified".

## Q3 [Domain] Is a copy a certified copy of the original record, and can the original be deleted?
ALCOA "Original" and Part 11 record retention treat the first-captured record specially. The delete after copy destroys the original and replaces it with a copy produced by a tool. Even with identical hashes, an inspector wants evidence of equivalence before the original is destroyed.
Example: A GLP study repository of 8 TB is renamed because the study code changed. The source is deleted after the copy "succeeds" but nobody compared digests.
Options: (a) a verification step comparing full-tree SHA-256 manifests of source and destination before delete, recorded in the Outcome (strong, slow); (b) delay deletion by a grace period (e.g. 14 days) with the source kept read-only (safe, double storage); (c) trust the copy tool.
Recommendation: (a) and (b), with (b) configurable and the deletion itself a signed action in strict mode.
Challenges: "Rename is implemented at the BFF as copy then delete".

## Q4 [Impl] How long does rename take, and what is allowed to happen to the repository meanwhile?
Copy time grows with size; a 2 TB repository takes hours and doubles disk use on the shared filesystem. During that window other users push, branch and merge. A pushed commit that lands after the copy snapshot is lost when the source is deleted.
Example: At 09:00 admin Lena starts renaming a 1.5 TB repo; at 10:40 Omar pushes a commit to the old name; at 11:10 the copy completes and the source is deleted. Omar's commit is gone.
Options: (a) put the repository in a read-only "migrating" state (writes return 409) for the whole operation (safe, downtime); (b) copy, then a second delta pass under a short write lock (less downtime, complex); (c) cap rename to repositories below a size limit.
Recommendation: (a) plus (c) with a warning showing size and estimated time before the admin confirms.
Challenges: "Rename as copy+delete is heavy for large repositories; consider size warnings" (a note, not a design).

## Q5 [Impl] What are the states and recovery of a rename that dies between copy and delete?
After a crash both repositories may exist, with the id pointing at neither, one, or both. The reconciler "re-queries oxen to infer the outcome", which here is ambiguous: a destination that exists could be complete, partial, or a stale leftover from an earlier attempt.
Example: Instance 3 is killed during the delete; the Intent has no Outcome. The reconciler finds both `lab/a` and `lab/a2`. Is `a2` complete?
Options: (a) an explicit rename state machine in PostgreSQL (copying, verified, switched, deleting, done) with lease and resume, the reconciler reads state not oxen (deterministic); (b) infer from oxen (cross-cutting decision, ambiguous); (c) operator manual cleanup.
Recommendation: (a); oxen is only checked as a safeguard.
Challenges: "a crash between steps is reconciled" via inference.

## Q6 [Impl] Authors must survive the copy, but the BFF overwrites authors on commit-bearing requests
ADR 0001 makes the BFF overwrite author name and email from the Principal on author-bearing writes, and unknown shapes are rejected unless allowlisted. A copy that replays through the BFF would stamp every historic commit with the admin who clicked rename.
Example: 12,000 commits by 40 scientists are rewritten with author "Lena Admin" during the move; ALCOA "attributable" is destroyed.
Options: (a) the copy runs inside a privileged path (BFF to oxen internally or filesystem copy) that bypasses injection and is allowlisted explicitly (preserves authors, new trusted path); (b) route through the normal pipeline (breaks attribution, rejected); (c) disallow rename.
Recommendation: (a), with the allowlist entry and its test documented as a validated exception.
Challenges: ADR 0001 author injection; "Rename is copy+delete at the BFF".

## Q7 [Domain] After rename, who may claim the freed name?
The old name is released. Someone can create a repository with the old name, and every bookmark, clone remote, PAT-scoped CLI configuration, script and notebook now silently talks to a different dataset. Audit events cite "name at event time" and the new owner of that name will look like the history of the old.
Example: `trials/ctx-02` is renamed to `trials/ctx-02-archive`; next month a new project creates `trials/ctx-02` and a nightly script pushes its output into the wrong study.
Options: (a) reserve the old name as a redirect for a long period (safe, name space grows); (b) release immediately (simple); (c) permanently reserve names that were ever used in a namespace.
Recommendation: (c) in strict or regulated namespaces, (a) elsewhere.
Challenges: Missing; "audit references name at event time".

## Q8 [Domain] Transfer: what happens to who can see the data?
Transfer moves a repository to another namespace whose members and base permission differ. Access may be a union of old collaborators, new namespace roles and base permission. Either members of the destination get read access they were never granted for this data, or the repo's explicit collaborators are dropped.
Example: A confidential `hr-study` repository, with 3 named collaborators, is transferred to namespace `all-staff` that has base permission "read"; 400 people can now read it.
Options: (a) strip inherited access and keep only explicit collaborators until the admin approves new roles (secure by default); (b) apply the destination's roles automatically (convenient, leaky); (c) show a diff of access change and require explicit confirmation.
Recommendation: (c) with (a) as the default.
Challenges: "preserve access"; transfer story 6 and "verify ... memberships" (unverified).

## Q9 [Domain] Is repo `admin` plus destination `write` enough authority to move regulated data?
A repository admin can send the repository to any namespace in which they have `write`, including a personal or other-team namespace, removing it from the owning group's control. The source namespace Owner has no say. It is also the cheapest exfiltration path for a leaving employee.
Example: A repo admin on a trial team has `write` in their own sandbox namespace and transfers the trial's repository there on their last day.
Options: (a) require source namespace Owner approval and destination Owner acceptance (two-sided, slower); (b) require destination namespace `admin` and source `admin`; (c) as decided.
Recommendation: (a) in strict; (b) otherwise.
Challenges: "Transfer requires repo `admin` and destination namespace `write` (confirm)".

## Q10 [Impl] Is transfer a copy+delete too, or an oxen operation?
The shipped UI calls a transfer route and e2e covers it, but rename on stock oxen is refused and the spec says "rename in stock oxen-server" is out of scope. It is not stated whether stock oxen implements transfer natively, how it handles in-flight pushes, or whether the spec will use the same copy mechanism and inherit all rename problems.
Example: The e2e passes against a development build; production runs a different oxen release whose transfer fails halfway through the filesystem move.
Options: (a) verify oxen's native transfer semantics (atomic filesystem move?) and wrap with the same state machine as rename; (b) implement transfer via the rename mechanism; (c) restrict transfer to empty repositories.
Recommendation: (a), testing against the pinned oxen release.
Challenges: Spec treats transfer as solved; "Open detail" only for rename.

## Q11 [Domain] The merge-as-gate decision can be bypassed by anyone with `write`
Merge needs `maintain`, but file writes to any branch, including the default branch, require only `write`; moving a branch pointer to another commit is also at the write level. The plan lists branch protection as unapproved. Under these rules the "review gate" gates one of several paths into the main line.
Example: A `write` user edits a result file directly on main through the file endpoint; no merge, no signature, no gate.
Options: (a) protect the default (and configured) branches: direct writes and pointer moves require `maintain` plus the same signature as merge in strict (closes the gate); (b) accept and rename it a "convention"; (c) build PR-like review.
Recommendation: (a) is a precondition for calling merge a review gate.
Challenges: "Merge+maintain is the review gate"; branch protection deferred.

## Q12 [Domain] Repointing a branch to an earlier commit is a history rewrite at `write`
The browsing page lets a user point a branch at a prior commit, which orphans later commits from that branch. In a GxP setting that is deletion of the main line's recent history. Commits survive in oxen's store, but not in any visible branch.
Example: A `write` user repoints main from C40 to C31 to "undo" a bad import; 9 commits, including 3 signed merges, vanish from the history views.
Options: (a) require `admin` and a reason, or forbid on protected branches (safe); (b) disallow and use revert commits only; (c) as is.
Recommendation: (b) for protected branches; (a) elsewhere.
Challenges: Role map puts branch update at `write`.

## Q13 [Impl] The CLI can merge locally and push. What does the BFF gate actually see?
The CLI wraps a local oxen client that can merge and then push the result. The server-side merge route requires `maintain`, but a locally merged commit pushed as a normal push needs only write permission and carries no signature. The BFF sees a push, not a merge.
Example: A scientist with `write` runs a local merge of two branches and pushes it to main; the audit event is "push", the signature requirement is never evaluated.
Options: (a) the BFF refuses pushes to protected branches that contain merge commits not created by the server-side merge (needs commit inspection); (b) protected branches accept pushes only through the server merge route; (c) accept.
Recommendation: (b), combined with Q11.
Challenges: Cross-cutting "identical behaviour from web, CLI and API".

## Q14 [Impl] The mergeability preview and the merge itself race
The merge page checks mergeability and conflicts, then enables the button; the actual merge runs later against whatever the branches are by then. With e-signature binding it may also be the only thing the signer reviewed. There is no server-side compare-and-swap on heads in the request.
Example: Preview shows 0 conflicts at 10:00; at 10:02 another push adds a conflicting change; the merge at 10:05 either fails with an opaque error or merges a result nobody reviewed.
Options: (a) the merge request carries expected source and target heads and the BFF rejects a mismatch with 409 (exact); (b) re-run mergeability inside the merge call (still racy); (c) as is.
Recommendation: (a), the same heads as the signature binding.
Challenges: Merge page behaviour described as shipped baseline.

## Q15 [Domain] "Configurable ceilings with defaults chosen during implementation" for previews and listings
In a regulated review a truncated preview can mislead. A reviewer who "approves" a merge after seeing the first 50 rows of a 2-million-row DataFrame has reviewed 0.0025%. The default page size is fixed at 50 and no ceiling is stated anywhere the owner can challenge.
Example: A reviewer approves a merge after a preview of 50 rows where row 51,204 contains an out-of-range value; the preview gave no sign it was truncated.
Options: (a) always show "showing N of M" with statistical summaries computed on the full data for DataFrames; (b) raise ceilings and show warnings; (c) as decided.
Recommendation: (a), and decide numbers now: for example text preview 1 MiB, tree page 500 entries, commit page 100.
Challenges: "Preview and listing ceilings are configurable with defaults chosen during implementation".

## Q16 [Impl] Listing performance at scale: where does paging happen, and what do N BFF instances buffer?
The browsing pages fetch the full commit list and a whole directory in one call and do client-side pagination. A repository with 300,000 commits or a 1-million-entry directory would be downloaded into the SPA and through the BFF proxy memory. oxen-server's own paging support is unverified.
Example: Opening the commits tab of a repo with 300k commits transfers 180 MB, and 20 users opening it concurrently put 3.6 GB through the BFF.
Options: (a) require server-side paging end to end, stream through the proxy, and reject unpaged requests above a limit; (b) a BFF-side cached index of commit metadata in PostgreSQL (fast, a derived store to keep right); (c) raise client limits.
Recommendation: (a) first; (b) only if oxen paging is inadequate.
Challenges: Phase 2 "proposed, not approved"; ceilings undecided.

## Q17 [Impl] New oxen routes under a repository are readable by default
ADR 0002 denies unclassified GET paths that carry no namespace and repository, but the plan's own risks table says unclassified read-only routes with a repo default to `read`. A future oxen release adding an export, debug or admin-ish GET route under a repository would be readable by every reader.
Example: An oxen upgrade adds a GET that returns repository configuration including remote credentials; all `read` users can fetch it the day the upgrade is deployed.
Options: (a) every GET under a repository must be on an allowlist, others are denied (consistent with the ADR's spirit); (b) keep, and make oxen upgrades require a route-diff review in CI; (c) as is.
Recommendation: (a), plus a contract test that fails when oxen exposes a route not in the table.
Challenges: ADR 0002 vs plan risk table; "test that authz path map and role enforcement agree".

## Q18 [Impl] Repository creation is two systems. How do we avoid ids without repositories and vice versa?
Creating a repository now writes an id mapping in PostgreSQL and creates the repository in oxen. With N instances and two users creating the same name simultaneously, or a crash between the two writes, there can be an id with no repository, or a repository oxen created with no id (invisible to authz).
Example: Two instances handle `create lab/new-assay` within 50 ms; both insert ids, one creates in oxen, the other gets "already exists" after its row committed.
Options: (a) unique constraint on namespace+name in PostgreSQL taken first, oxen create second, a reconciler for orphans in both directions; (b) create oxen first and register after (leaks unregistered repos); (c) two-phase state "creating".
Recommendation: (c) via (a).
Challenges: New gap; the reconciler is described only for rename.

## Q19 [Domain] Deleting a repository with "retain forever" records and live dependents
Delete cascades to platform data, but audit is immutable and retained forever, lineage references it, Jobs Pin its commits, signatures bind to its commits, and someone may be running a Desktop Session on it. "Nothing is orphaned" cannot be true for immutable records.
Example: Deleting `trials/ctx-02` removes the data, while 14 signed merges, 600 lineage edges and 3 running Jobs still reference it.
Options: (a) soft delete: archived, hidden, read-only, hard deletion only after a retention period or by a signed, dual-controlled action (safe, storage held); (b) hard delete with tombstones preserved in lineage and audit; (c) forbid deletion in strict.
Recommendation: (a), with (c) for repositories that carry signatures.
Challenges: "delete a repository and have dependent platform data cleaned up"; "retention forever".

## Q20 [Domain] Namespace deletion removes all repositories in one action
The namespace delete UI passes a flag that deletes every repository inside. It needs no signature, reason policy or extra confirmation in the spec, and it is not in this module's decision list. Under strict mode a single click can remove an entire department.
Example: An owner deletes namespace `oncology` thinking it is empty; 61 repositories with 9 TB are removed.
Options: (a) refuse to delete a namespace that contains repositories; each repository must be deleted/archived separately (safe); (b) allow with typed confirmation, reason and signature, each repo audited; (c) as is.
Recommendation: (a) in strict, (b) otherwise.
Challenges: Shipped namespace cascade delete (Phase 0 baseline).

## Q21 [Impl] Namespaces have no stable id either
Only repositories get a stable id. A namespace is the unit for roles, membership and base permission, yet authz is keyed on its name and nothing in the plan covers renaming namespaces. Either namespace rename is forbidden forever or the id problem recurs.
Example: A department reorganises and wants `oncology` renamed `oncology-research`; 200 repositories, memberships and favorites reference the old name.
Options: (a) give namespaces stable ids now, for symmetry (migration once); (b) declare namespaces immutable names and document; (c) defer.
Recommendation: (a) in the same migration as Q1.
Challenges: New gap.

## Q22 [Domain] There is no way to remove sensitive data that was committed by mistake
History in oxen is immutable by design, and the platform adds retained audit. A scientist who commits an unblinded patient list or a credential cannot remove it; repointing a branch or deleting a repository leaves the data in the store. There is no process, only an assumption that the product is append-only.
Example: A file with 3,000 patient identifiers is pushed to a repository with 120 readers; deleting the file in a new commit leaves it in every prior commit.
Options: (a) define an audited, dual-controlled "purge object" procedure for administrators (needs oxen support or filesystem surgery, and conflicts with "no purge API"); (b) delete the whole repository and restore from copies; (c) document that it is impossible and require pre-commit scanning.
Recommendation: (a) as a documented break-glass runbook, with (c) scanning as prevention.
Challenges: "retention forever"; "no product API to purge".

## Q23 [Impl] Tags were dropped, but pins need immutable named versions
The spec says repository tags are covered by PLAT-META tags, which are mutable labels. The plan's earlier text wanted tags as named releases pinning a commit, also to serve Jobs and Desktop Sessions. Mutable labels cannot serve as release markers in a regulated setting.
Example: "release-2026-Q3" is a label; a maintainer moves it to another commit after the QA review.
Options: (a) immutable "release" records (id, commit, signer, time) owned by this module (a new concept); (b) metadata labels only; (c) oxen branches by convention.
Recommendation: (a) in strict, with (b) for organisation.
Challenges: "A separate repository tag store is dropped".

## Q24 [Domain] No archive or read-only state for finished studies
A closed study should be frozen: no writes, no branch changes, visible for audit. The only options are leaving write permissions in place or deleting the repository. Phase 3 lists archive as unapproved.
Example: A finished 2024 trial still lets any `write` collaborator push to main in 2027; nothing flags it.
Options: (a) an audited "read-only/archived" repository state enforced at the BFF, reversible only with a signature; (b) revoke all write roles manually; (c) as is.
Recommendation: (a), small and prerequisite for the deletion policy in Q19.
Challenges: Phase 3 deferral.

## Q25 [Impl] Many instances share one oxen-server and one filesystem. What is the ceiling?
Rename, delete, merges and uploads all land on the same oxen-server and the shared RWX storage, and the owner has not decided the deployment target. N BFF instances multiply the proxies, not the oxen capacity. A copy of a large repository saturates the storage and starves interactive requests.
Example: A 1.5 TB rename on Tuesday morning saturates the filesystem at 800 MB/s; scientists' pushes time out at 60 s.
Options: (a) throttle copies and run them at low priority with limits per operation (needs a scheduler); (b) schedule heavy lifecycle operations in off-hours windows; (c) a separate oxen-server per namespace group (heavy).
Recommendation: (a) and (b).
Challenges: Deployment target undecided; "N BFF instances".

## Q26 [Impl] How do we test rename failure when the test seam is black-box HTTP?
The spec requires a test that simulates failure in the middle of a rename, but the single seam is the BFF HTTP boundary against real containers. Crashing an instance on cue, or making oxen fail at the delete step, needs fault injection that the black-box rule excludes. Two instances must also be exercised.
Example: The test kills the BFF container at "copy done" by polling status, but the window is 40 ms on a small repository and the test is flaky.
Options: (a) a fault-injection proxy between the BFF and oxen that fails the Nth call (external, deterministic enough); (b) a test-only hook in the BFF (breaks black-box); (c) use large repositories so the window is wide (slow).
Recommendation: (a), plus (c) for the 2-instance resume scenario.
Challenges: "Single seam ... black-box" vs the required mid-rename failure test.

## Decisions log
| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Inherited: ids at creation (02 Q4) | answered |
| Q2 | Spike answer given, BUT superseded by Q25 owner proposal: keep oxen physical repo names static (stable id) and rename only in BFF persistence layer => commit ids never change; copy-based rename not needed | answered |
| Q3 | Answered (manifest compare + 14-day read-only grace + signed final delete) but largely moot under Q25 static-name approach; remains for any future physical move | answered |
| Q4 | Freeze read-only with size cap — moot under Q25 (no copy); keep for physical moves only | answered |
| Q5 | State machine in Postgres — moot under Q25 for rename; keep for repo creation/physical moves | answered |
| Q6 | Privileged author-preserving copy path — moot under Q25 | answered |
| Q7 | Inherited: old name 404/410 for period (02 Q5) | answered |
| Q8 | Access-change diff + explicit confirmation; default keep only explicit collaborators | answered |
| Q9 | Inherited: 02 Q6 | answered |
| Q10 | Owner: implement transfer via rename mechanism => with Q25, transfer is a BFF metadata change (namespace id re-pointing) with no oxen move; confirm oxen paths do not embed namespace | answered |
| Q11 | No direct writes on main (default branch); always require approval (signature) via merge | answered |
| Q12 | Revert commits only everywhere; no branch repointing | answered |
| Q13 | Pushes to main only through server merge route; BFF rejects direct pushes | answered |
| Q14 | Merge carries expected source/target heads; 409 on mismatch | answered |
| Q15 | N of M + full-data summaries; text 1 MiB, tree page 500, commit page 100 | answered |
| Q16 | Server-side paging e2e, streaming, reject unpaged above limit; PG index only if needed | answered |
| Q17 | Inherited: deny unclassified routes (02 Q2) | answered |
| Q18 | 'creating' state in PG via unique constraint, then oxen create; two-direction orphan reconciler | answered |
| Q19 | Inherited: no hard delete (02 Q24) | answered |
| Q20 | Inherited: archive only (02 Q24) | answered |
| Q21 | Namespace stable ids now, same migration as repo ids; display names changeable | answered |
| Q22 | No purge in product; documented dual-controlled audited operator runbook + pre-commit scanning | answered |
| Q23 | Immutable release records (id, commit, signer, time); labels mutable metadata | answered |
| Q24 | Inherited: archive state (02 Q24) | answered |
| Q25 | OWNER PROPOSAL (CONFIRMED): keep oxen repository names static (physical key = stable id) and rename only in BFF persistence layer. Throttling of big copies then only for Jobs/uploads. Needs CLI/clone-URL translation via BFF | answered |
| Q26 | Inherited: test-only fault-injection hooks (00 Q13); rename tests simplify under Q25 | answered |

---

# Known Issues and Conflicts

## Rename design superseded
- **Q2 superseded its own spike answer; Q3, Q4, Q5, Q6 largely moot**: The earlier rename-as-copy text was removed. OVERRODE copy-based rename. Owner proposal (Q25 confirmed): keep oxen physical repository names static (physical key = stable id) and rename only in BFF persistence layer. Commit ids never change; copy-based rename machinery not needed. Questions Q3-Q6 (freeze, state machine, privileged copy, manifest compare) remain only for any future physical move.

## Transfer as metadata operation
- **Q10 (confirm oxen paths do not embed namespace)**: PENDING with static physical keys by stable id. Transfer is now a BFF namespace re-pointing with no oxen move (Q10, 02 Q6). If oxen paths embed namespace anywhere, transfer breaks. Must verify against pinned oxen.
- **Original spec said transfer needs destination `write`; 02 Q6 requires destination namespace Owner approval**: Spec now follows 02 Q6. Transfer needs source repo `admin` + destination namespace Owner approval; collaborators dropped by default (Q8).

## CLI and clone URL translation
- **Q25 needs CLI and clone-URL translation through BFF**: RISK. With static physical names (opaque ids), the 07-cli module MUST implement name translation. Clone URLs and CLI commands reference display names; BFF translates to physical ids. If 07 does not implement this, repositories are unreachable by name.

## Protected branch and force-push risks
- **Q11 with 04 (merge signer must not be an author in the range)**: Enforced in this module; one approver suffices, no two-mergers rule. No direct writes on validated branches; signature via merge always required.
- **Q12 (no branch repointing, revert commits only everywhere)**: Means only main is protected globally (02 Q17). Force-push or delete of other released branches is unprotected. RISK accepted as chosen. 05 Q12 mitigates with revert-only policy.

## Purge and secrets conflict
- **Q22 (no purge in product) conflicts with secrets in history**: Mitigated only by operator runbook (dual-controlled, audited) plus pre-commit scanning. RISK: a committed secret stays in history forever. No product API to remove it. Break-glass manual procedure documented but not built.

## Backup and id-to-name mapping
- **Static names make oxen layer opaque to operators**: The id-to-name mapping in Postgres is a single point of recovery. Needs backup (04 Q16). If Postgres id mapping is lost, oxen physical directories (keyed by id) cannot be resolved to display names.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 02 (Authorization)**: Stable repository ids (Q1/02 Q4) are foundational. Rename (Q25) keeps ids stable, so grants persist. Transfer (Q6/02 Q6) needs Owner approval.
- **Blocks 05 (Repositories) internal**: Merge gate (Q11), protected branches (Q13), revert-only (Q12), and merge-head binding (Q14) define how the review gate works.
- **Blocks 07 (CLI)**: Static physical names (Q25) require CLI to translate names and clone URLs through BFF (Q25/07 Q25). CLI must resolve display names to ids before oxen operations.
- **Blocks 08 (Workspaces)**: Workspace base commits reference repository ids. Rename-by-metadata (Q25/08 Q9) means Workspaces survive rename. Jobs (09 Q28) also reference repo ids.
- **Blocks 09 (Jobs)**: Rename refused while Jobs or leases exist (09 Q28). Job Pins reference commit ids; static names (Q25) ensure commit ids never change.
- **Blocks 11 (Lineage)**: Lineage uses stable repository ids (Q21/11 Q21). Static physical names (Q25) keep commit ids unchanged, so lineage edges remain valid.

## Depends on
- **Depends on 00 (Cross-cutting)**: No hard delete (Q19/02 Q24); archive only. Rename as metadata change (Q25/00 Q7 superseded).
- **Depends on 01 (Authentication)**: Merge signer differs from author (Q11). Step-up for signing (01 Q8/04 Q6). Author injection (Q6/01 Q10) applies to all commits.
- **Depends on 02 (Authorization)**: Two-merger rule (Q11/02 Q1), protected branches (Q17/02 Q17), transfer approval (Q6/02 Q6), unclassified routes denied (Q17/02 Q2).
- **Depends on 03 (Audit)**: Rename and transfer as dedicated audit actions (Q10). Dataset head before/after (inherited 00 Q6/03 Q7).
- **Depends on 04 (GxP Compliance)**: Immutable release records (Q23/04 Q23). Signed delete for repositories with signatures (Q19).

## Cross-cutting impacts
- **00 (Cross-cutting)**: Rename design (Q25) supersedes 00 Q7 (copy-based rename). Static physical names simplify rename, eliminate copy risks (Q2, Q3, Q4, Q5, Q6).
- **02 (Authorization)**: Grants keyed by stable repo id (Q1/02 Q4). Rename (Q25) and transfer (Q6/Q10) preserve id, so authz unaffected. Access-change diff on transfer (Q8).
- **03 (Audit)**: Rename and transfer have dedicated audit actions (Q10). No "other" classification. Dataset head (00 Q6/03 Q7) captured where applicable.
- **04 (GxP Compliance)**: Merge requires signature (Q11/04). SHA-256 manifest (Q23/04 Q23). No purge (Q22/04 Q17) means secrets stay forever unless manual break-glass.
- **07 (CLI)**: Name translation (Q25) is CLI responsibility. Clone URLs use display names; CLI must resolve via BFF.
- **08 (Workspaces)**: Workspace base commits reference repo id. Rename (Q25/08 Q9) is metadata-only, Workspaces survive.
- **09 (Jobs)**: Job Pins reference repo id + commit id. Rename (Q25/09 Q28) refused while Jobs exist. Static names keep commit ids stable.
- **11 (Lineage)**: Stable ids (Q21/11 Q21). Static physical names (Q25) mean commit ids unchanged; lineage edges valid forever.
- **12 (Metadata/Search)**: Repository metadata keyed by stable id. Rename (Q25) updates display name only; search index must re-index name field.
- **16 (Operations)**: Backup (04 Q16) must include Postgres id-to-name mapping. Without it, oxen physical directories cannot be resolved.

