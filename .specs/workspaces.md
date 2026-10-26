Status: needs-info
Blocked on: overlay-on-RWX spike on the real target filesystem (Q1, unresolved; gate for Workspaces on Kubernetes, fallback copy/node-local scratch).

# 08 — Workspaces and Stages (PLAT-WS)

## Problem Statement

Jobs and Desktop Sessions need isolated, writable working trees over a shared checkout pinned to a commit, without copying large data. With multiple BFF instances, leases and fencing must hold across processes, and the storage layer must support the mount technique.

## Solution

Mice Workspaces: overlay working trees over a shared checkout, with exclusive write leases, a frozen state while a job runs, quotas, and commit/merge back to oxen. Fencing is enforced by a PostgreSQL generation check as well as by the workspace controller. Oxen's own workspaces are called **Stages**.

## User Stories

1. As a scientist, I want a workspace pinned to a commit, so that my work starts from a known version.
2. As a scientist, I want edits to go to a private layer, so that the shared checkout is untouched.
3. As a scientist, I want to see a live diff against the base, so that I know what changed.
4. As a scientist, I want to commit and merge my changes to oxen, so that results are versioned.
5. As a scientist, I want a clear conflict outcome on update, so that I can resolve it.
6. As a second writer, I want a lease with queueing and a visible holder, so that two people do not clobber each other.
7. As an admin, I want to force-release a stale lease, audited, so that work is not blocked.
8. As a scientist, I want the workspace frozen while a job runs and its partial output kept on failure, so that I can inspect it.
9. As a Desktop Session user, I want a read-only live view, so that I can watch job output.
10. As an operator, I want a stale instance's writes rejected by a generation check in PostgreSQL, so that fencing works across instances.
11. As an operator, I want quotas per workspace and in total, so that disks are protected.
12. As a workspace owner, I want notifications for lease contention, quota exhaustion, failed commit, stuck operations, so that I can act.
13. As a security reviewer, I want symlinks, devices and sockets never followed or committed, so that untrusted trees are safe.
14. As an auditor, I want a digest and counts of each conflict resolution in the audit event, with full detail held in Postgres, so that three-way updates are reconstructable.
15. As a user, I want Stages in the UI, CLI and favorites, so that Oxen workspaces have a distinct name.
16. As an admin, I want old `workspace.*` roles to keep working during migration to `stage.*`.

## Implementation Decisions

- Bulk tree state lives on a shared RWX filesystem; leases and generations in PostgreSQL.
- **Unresolved:** Linux overlayfs does not support NFS/CephFS as upperdir. Kubernetes is the production target (16 Q1); a time-boxed spike on the real target filesystem with pass criteria is the gate. Candidates: reflink/copy on shared storage, with node-local upper as an optimisation. Fallback: copy or node-local scratch. The spike must decide before implementation of W4.
- Fencing token: a generation counter in PostgreSQL checked by every mutation, plus the controller.
- Mutations are audited with Intent/Outcome and fail closed (GxP strict is always on). Lease renewals are not exempt: each renewal has its own Intent/Outcome (Q18 aggregation dropped).
- Stages naming and authz migration as in 02.
- Untrusted-tree rules, quotas and a file-count cap are retained.
- Conflict detail is held in Postgres; the audit event carries a digest and counts (Q16).
- Backup/restore is a hard start gate (04 Q16, 16 Q2); an interim backup of the upper is taken once backup exists.

## Testing Decisions

- HTTP tests for leases, commit, merge, update conflicts and quotas; two BFF instances test fencing.
- Filesystem-level behaviour is tested through the API, not internal files.
- Prior art: TC-WS tests and the W0 spike harness.

## Out of Scope

A second overlay mount for a live view (snapshot refresh or helper via the writer mount is used instead, Q10).

## Further Notes

Spike on 2026-10 verified Docker Desktop overlay volumes only; shared-FS behaviour is untested.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Storage and leases
- Spike on the real target filesystem first; reflink/copy on shared storage is the candidate, node-local upper an optimisation (Q1).
- A Workspace is transient with stated loss risk; successful job results are auto-committed to a branch; interim upper backup once backup exists (Q2).
- Controller kills the old container before a new lease; unreachable node means refuse (Q4).
- Lease expiry uses database time; force-release stops the holder first, with confirmation (Q5).
- Fencing check rejects stale uploads, offering the saved tar, plus extraction limits (Q26).
- Postgres advisory locks and build rows serialise builds (Q21).
- Live view uses snapshot refresh or a helper via the writer mount, never a second overlay mount (Q10).
- Re-authorize at each renewal and commit; denial terminates the lease, output kept, commit blocked (Q11).
- Users stop their own sessions only; others are notified with grace; Maintain override is audited (Q17).

Commit, merge and conflicts
- Failed-job output is committable only on acknowledgement; commit and lineage carry the failure state (Q3).
- Automated job commits are never signed; lineage shows unsigned/pending; merge to main needs a human signature (Q7).
- Commit fails unless skipped entries are acknowledged (recorded on the Outcome); in-tree symlinks become manifest entries (Q13).
- Discarded "theirs" files are preserved on a safe branch or hold area (Q15).
- Conflict detail in Postgres; digest and counts in the audit event (Q16).
- Postgres operation journal is authoritative; the reconciler reads it, then oxen (Q8).

Quotas, integrity and isolation
- Filesystem project quotas plus a controller hard-ceiling kill that keeps output (Q12).
- Incremental size+mtime scans, full hash at commit, no overlapping scans, stated freshness (Q14).
- Verify at build and at mount for pinned jobs; full scrub within days (Q23).
- Delete by owner or Maintain; quality hold flag; soft delete for N days, no hard delete (Q24).
- Per-namespace UID ranges and non-deduplicated stores for regulated namespaces (Q27).
- A separate runner service holds Docker socket or Kubernetes credentials; the BFF never mounts them (Q22).

Operations and naming
- Severity tiers: immediate for stuck/critical, daily digests for low severity (Q19).
- Linux CI mirrors the production filesystem with chaos tests (Q25).
- Stages have distinct docs and labels with a visible id type; reviewed after Workspaces ship (Q28).
- Lease renewals: audited per renewal with Intent/Outcome; if immudb is down the lease expires and work stops (Q18 revised).

## Conflicts and open risks

- Q1: spike still UNRESOLVED; gate for Workspaces on Kubernetes (16 Q7), fallback copy/node-local scratch.
- Q18: RESOLVED strict: no aggregation. Risk: high audit event volume; capacity-plan immudb.
- Q2: interim upper backup depends on backup existing; backup is a hard start gate (04 Q16), so the interim state must not run in regulated use.
- Q7 and 00 Q19: unsigned automated commits need a named responsible human owner on the event.
- Q16 versus 03: conflict detail lives in Postgres, outside immudb; retention of that detail is not set.
- Q19 versus 14 Q18: notification tiers must align with the heartbeat-based stuck detection in 14.
- Q28: Stages review deferred until Workspaces ship (DEFERRED).
- Q23 and Q24 versus 00 Q8: soft delete only; any erasure is out of scope.

---

# Open Questions


Status: needs-info and blocked on an overlay-on-shared-filesystem decision that the 2026-10 spike did not answer (it verified Docker Desktop only).
Biggest risks: the storage decision invalidating the design, uncommitted scientific data with no backup, workspace commits bypassing the review gate, and lease/fencing under fail-closed auditing.
Questions are tagged [Domain] or [Impl]; each lists options and a recommendation so the owner can answer quickly.

## Q1 [Impl] Which overlay strategy do we commit to, given upperdir cannot live on a network filesystem?
The cross-cutting decision requires N BFF instances and a shared RWX filesystem for trees, but the Linux kernel does not support NFS or CephFS as the writable upper layer of an overlay. The only verified result is Docker Desktop on one machine. Every other part of the module (leases, quotas, scans, commit) depends on which of the three alternatives is chosen, so this decision blocks W4 and arguably all of the module.
Example scenario: A 2 TB workspace on a node-local upper is only reachable from that node; instance 2 receives the commit request and cannot see the files.
Options: (a) node-local upper with workspace pinned to a node; (b) reflink or copy tree on the shared filesystem; (c) node-local upper synced to shared storage at lease release. Trade-off: (a) fails node loss and placement; (b) costs disk and copy time; (c) has a durability window.
Recommendation: (b) as default if sizes allow, with (c) as an optimisation; do the spike on the real target filesystem first.
Challenges: "shared RWX filesystem ... overlayfs-on-RWX unresolved".

## Q2 [Domain] Is an unbacked-up workspace upper a GxP record, and is that acceptable with backup deferred?
The workspace holds uncommitted results, a failed job's partial output stays until the user deletes it, and retention is forever. Backup and restore are deferred. If a scientist's only copy of a three-day computation lives in an upper layer on one disk, ALCOA's Enduring and Available are not met by design.
Example scenario: A node's disk fails on day four of a job; the 600 GB output existed nowhere else and the audit trail says the job succeeded.
Options: (a) define workspace content as transient working data with a stated loss risk and force commit for anything to be kept; (b) include uppers in an interim backup; (c) auto-commit successful results to a branch immediately. Trade-off: (b) needs the deferred backup tooling.
Recommendation: (a) now stated in the intended use, with (c) for successful jobs.
Challenges: "backup/restore deferred"; "failed-job outputs stay in workspace".

## Q3 [Domain] Does keeping failed-job output in the workspace create evidence or create risk?
Failed output is kept indefinitely until deleted, with no marker that it is incomplete. A user can commit partial output of a failed run into the repository as if it were valid. Deviation investigations also need that output preserved, but the delete route is available to any writer.
Example scenario: A job fails at 80%, the user clicks Commit changes to "save progress", and the partial CSV becomes the latest dataset.
Options: (a) failed output is excluded from commit unless explicitly acknowledged and labelled in lineage; (b) lock the workspace read-only until a maintain role acts; (c) keep as is. Trade-off: (a) adds a label but not a gate.
Recommendation: (a), recording the job failure state on the resulting commit and lineage.
Challenges: Decision D5 as recorded.

## Q4 [Impl] How can fencing stop a zombie container that is already writing?
The fencing token is a PostgreSQL generation check plus the controller. A running job container writes straight into the workspace; it does not call the BFF per write. A fence enforced at operation boundaries rejects a stale commit but does nothing about a partitioned container still writing for hours.
Example scenario: Node 3 loses contact, the lease expires, a new holder starts, and the old container keeps overwriting files in the same upper.
Options: (a) on new lease grant the controller kills the old container before granting; if it cannot reach the node, refuse; (b) filesystem-level fencing by revoking the mount; (c) accept op-boundary fencing only. Trade-off: (a) can block availability when nodes are unreachable.
Recommendation: (a), fail closed.
Challenges: "Fencing is enforced by a PostgreSQL generation check as well as by the workspace controller".

## Q5 [Impl] What are lease TTL, renewal and force-release semantics across multiple instances and clocks?
Leases live in PostgreSQL and are renewed by sessions and jobs. Which clock decides expiry (database time or instance time) is unspecified; so is what force-release does to a running job and its unsaved changes. Admin force-release audited after the fact does not make the data safe.
Example scenario: An admin force-releases a lease on a workspace whose job is 90% done; a second user acquires and the job's output is interleaved with new edits.
Options: (a) database time for all expiry and force-release only on stopped holders; (b) force-release always stops the holder first; (c) as is. Trade-off: (b) loses holder's work.
Recommendation: (a)+(b), with a confirmation naming the holder's running work.
Challenges: "force-release a stale lease, audited".

## Q6 [Domain] Does workspace commit and merge bypass the Merge+maintain review gate?
Jobs auto-commit and the plan merges the safe branch into the target branch. If a writer's commit is merged automatically, unreviewed computational output reaches the target without a maintain user. The owner's gate is Merge+maintain, so the question is who performs the merge for auto-commits.
Example scenario: A nightly job with write access auto-merges its output into main; a downstream analysis pins that commit as reviewed.
Options: (a) workspace commits go to a safe branch only; merging into target requires a person with maintain; (b) auto-merge allowed per repo by policy; (c) as in the plan. Trade-off: (a) breaks job automation unless a queue exists.
Recommendation: (a) by default, (b) as an explicit repo policy.
Challenges: "Merge+maintain is the review gate"; plan section on commit step 5.

## Q7 [Domain] Who signs an auto-committed result under the e-signature decision?
The e-signature is the maintain user at merge, with no separate approver. For job output there is no human at merge time, and the user who started the job is a writer. A signature manifested for an automated merge would be the maintainer's name on data they did not review.
Example scenario: A maintain-role service principal owns the merge step; every job result carries its signature.
Options: (a) no signature for automated merges and an explicit "unsigned" state in lineage; (b) pending-signature queue; (c) delegate signing. Trade-off: (c) is a Part 11 problem.
Recommendation: (a)+(b).
Challenges: "e-sig = maintain user signs at merge".

## Q8 [Impl] How do multi-step commit operations map to Intent and Outcome events and the reconciler?
Commit is five steps: create a safe branch, build the commit, merge, advance base, queue compaction. Reset, update and compaction do not touch oxen at all, so the reconciler has nothing to re-query. One Intent per step multiplies audit volume; one Intent per operation needs a durable op journal.
Example scenario: The BFF crashes after oxen created the commit and before the merge; the reconciler sees a safe branch with a new head and must decide between rolling back and completing.
Options: (a) operation journal in PostgreSQL is authoritative and the reconciler reads it first, oxen second; (b) per-step events; (c) rely on oxen inference. Trade-off: (a) adds the journal but is deterministic.
Recommendation: (a).
Challenges: "reconciler re-queries oxen to infer outcome".

## Q9 [Impl] Does rename-by-copy-and-delete preserve commit ids, and what happens to existing workspaces and Pins?
The cross-cutting decision implements rename as copy then delete at the BFF, keeping the stable repository id. If the copy recreates history, commit hashes may differ, which invalidates every Pin, workspace base commit, lineage reference and checkout keyed by commit and name. Workspaces under lease during rename point at a repo that vanishes.
Example scenario: A repository with 14 workspaces and 200 Pins is renamed; every base commit is gone from the new repo or has a different hash.
Options: (a) block rename while leases or workspaces exist and prove copy preserves hashes first; (b) map old to new via the stable id; (c) forbid rename. Trade-off: (c) is safest.
Recommendation: (a), verified by test against real oxen.
Challenges: "rename = copy+delete at BFF with stable repo id".

## Q10 [Impl] Is mounting the same upper in several overlay mounts, as the live view does, supported by the kernel?
The Desktop Session live view mounts the running job's workspace read-only while the job writes. Overlayfs documents modification of underlying layers while mounted as undefined. A second mount on the same upper layer is outside the supported usage.
Example scenario: A reader sees a renamed directory half-applied or a file that disappears in the middle of a read.
Options: (a) live view reads through the writer's own mount by a helper; (b) snapshot refresh every N seconds; (c) no live view. Trade-off: (a) is safe but needs a service on the writer node.
Recommendation: (a) or (b).
Challenges: "Desktop Session read-only live view".

## Q11 [Impl] Are authorization changes applied to existing leases and mounts?
Authorization is checked at lease grant and at connect, and nowhere afterwards. A Principal who is offboarded, loses a training record or has a role removed keeps a write lease and a running container for the rest of the job. Because offboarding is manual and per iss+sub, the window between the HR decision and the revoke is already long, and the lease can outlive both.
Example scenario: A contractor's access is revoked at 09:10, but their 20-hour job holds a lease and commits its result at 03:00 the next day, attributed to a Principal who no longer exists.
Options: (a) re-authorise at every lease renewal and at commit, terminating the lease when denied; (b) check only at commit time; (c) check only at grant. Trade-off: (a) can interrupt long jobs but is the only one that bounds exposure.
Recommendation: (a), and (b) always as a final gate.
Challenges: "re-checked at lease grant and at connect"; "manual offboarding only".

## Q12 [Impl] Do quotas actually protect the disk if a running job is never killed?
Quotas count upper bytes only, are checked every 30 seconds, and a running job is never killed when over quota. A single job can write gigabytes per minute, so the check is advisory at best. The shared checkout store has a separate watermark, and with N instances each scan cache is local, so the same workspace may be evaluated differently by different instances.
Example scenario: A misconfigured job writes 4 GB per minute onto a 2 TB shared volume; within 8 minutes the quota is exceeded, within 8 hours the volume is full and every other workspace and checkout build fails with 507.
Options: (a) filesystem-level project quotas that make writes fail at the limit; (b) controller kills the job at a hard ceiling and marks it failed with kept output; (c) alerts only. Trade-off: (a) is a real control but depends on the filesystem; (b) loses a run; (c) is not a control.
Recommendation: (a) where available plus (b) at a hard ceiling above the soft quota.
Challenges: "a running job is never killed"; "quotas per workspace and in total".

## Q13 [Domain] Is silently skipping symlinks and special files compatible with complete data?
The untrusted-tree rule says symlinks, devices and sockets are never followed or committed. Scientific outputs routinely contain symlinks: index files, "latest" pointers, links to shared reference directories. A commit that drops them is not the same as the workspace the scientist saw, which is a completeness problem rather than just a security feature.
Example scenario: A pipeline's output directory is 300 symlinks to reference files; the commit contains none of them, the job shows success, and nobody learns until reproduction fails.
Options: (a) the commit fails unless the user acknowledges the list of skipped entries, recorded on the Outcome event; (b) record in-tree symlinks as manifest entries without following them; (c) skip silently with only a counter. Trade-off: (a) adds friction; (b) needs oxen to accept link entries.
Recommendation: (a) now, counts and names on the Outcome event.
Challenges: "symlinks, devices and sockets never followed or committed".

## Q14 [Impl] Will live diff scans and hashing scale to the file-count cap on a shared filesystem?
The default cap is a million files, scans run every 30 seconds while a writer exists, and a commit streams a hash per file. Metadata operations on RWX network storage are much slower than local disk, and hashing tens of gigabytes per scan is not feasible. The plan's scan cache is per instance, so scans may repeat.
Example scenario: A 900,000-file workspace needs 4 minutes to scan; the next scan starts before the first finishes and the live diff lags permanently.
Options: (a) incremental scans keyed on size and mtime with full hashing only at commit; (b) filesystem event watching; (c) fixed periodic full scans. Trade-off: (a) can miss an edit that keeps size and mtime; (b) is unreliable on network storage.
Recommendation: (a), with a full hash at commit and a stated limit on live-diff freshness.
Challenges: "file-count cap retained" as sufficient; live diff user story.

## Q15 [Domain] What is the data-loss story for choosing "theirs" in a three-way update?
Resolving a conflict with theirs drops the local upper entry. The audit records hashes, conflict types and who chose, but never contents, so the discarded work cannot be reconstructed from audit. The open question about retaining conflict detail only covers metadata, not the lost bytes. ALCOA's Original and Enduring are at risk for any data that existed only in the workspace.
Example scenario: Sofia chooses theirs for 40 paths in a bulk dialog and later realises 6 of them held a manually corrected table; the audit shows what happened but the table is gone.
Options: (a) preserve discarded files on a safe branch or in a hold area before applying; (b) retain in the workspace for N days; (c) hashes only. Trade-off: (a) uses storage but gives real recovery.
Recommendation: (a).
Challenges: "Conflict detail is recorded in audit; retention in the workspace is open".

## Q16 [Impl] How large can an audit event for a conflict-heavy update get, and where does the detail live?
Durable conflict detail per path (type, three hashes, choice, chooser) is required, and strict mode fails closed on it. A rebase with tens of thousands of conflicts produces a very large record. Immudb handles values, but very large entries hurt throughput and review, and truncation defeats the purpose of reconstruction.
Example scenario: A genomics workspace updates across 80,000 changed paths; the conflict record is about 25 MB and the update cannot proceed because the Intent append is too large.
Options: (a) full detail in PostgreSQL with its digest and counts in the audit event; (b) chunked linked audit events; (c) truncate with a count. Trade-off: (a) splits evidence across stores but keeps audit light.
Recommendation: (a), with the digest making the detail tamper-evident.
Challenges: "Conflict detail is recorded in audit".

## Q17 [Domain] Is "Stop sessions and update" acceptable when sessions belong to other people?
Update from branch needs every container off the workspace, and the UI offers to stop sessions. Desktop Sessions of other users may hold unsaved work, and who may stop them is not defined. Stopping them is a mutation on someone else's resource, driven by a convenience button.
Example scenario: A writer clicks "Stop sessions & update" while a colleague's Desktop Session has an hour of unsaved analysis in memory.
Options: (a) a user may stop only their own sessions; others must be asked through a notification and grace period; (b) maintain role may force; (c) anyone with write. Trade-off: (a) delays updates.
Recommendation: (a) with (b) as an audited override.
Challenges: Update flow, "frozen state".

## Q18 [Impl] Does lease renewal keep working when immudb is unavailable under strict mode?
Strict mode refuses any mutation whose Intent cannot be stored, with no class exempt. Lease renewals and heartbeats are mutations of PostgreSQL state occurring every few seconds per holder. If each needs an Intent, an immudb outage of a couple of minutes expires every lease and fencing then kills every running job.
Example scenario: A two-minute immudb restart expires 40 leases; the fencing logic stops 40 containers that had hours of compute remaining.
Options: (a) renewals carry no per-event audit and are summarised in the lease Outcome events; (b) lease TTL longer than any tolerated audit outage; (c) renewals are strict mutations. Trade-off: (a) departs from "no class exempt" but keeps work alive.
Recommendation: (a) written down as an explicit exception, or (b).
Challenges: "GXP_STRICT fail-closed for ALL mutations".

## Q19 [Impl] Does the notification design avoid alert fatigue and missed critical events?
All categories default on and recipients include the creator, holder and repo admins. Lease contention, stuck operations and compaction stalls are frequent. The plan left rate limiting unanswered, while the owner's decision removes opt-in as a relief.
Example scenario: An admin of 30 repositories gets 200 contention notices daily, mutes the category, and misses a genuinely stuck commit.
Options: (a) severity tiers with digests for low-severity events and immediate for stuck operations; (b) opt-in for noisy categories; (c) default on everywhere. Trade-off: (b) breaks the owner decision.
Recommendation: (a).
Challenges: "all notification categories on by default"; Q2 in the plan.

## Q20 [Impl] Do aliased workspace roles silently grant rights on the new overlay Workspaces?
During the Stage migration the old workspace role actions keep working through aliases. The same word is now the resource name for Mice Workspaces. An alias that maps the legacy action to both resources hands existing custom-role holders rights over a resource they never had.
Example scenario: An intern role granted workspace write for Oxen workspaces can now take write leases on overlay Workspaces and commit job results.
Options: (a) aliases map to the stage resource only and Workspaces get explicit new grants; (b) map to both; (c) require migration before the release. Trade-off: (a) may surprise users who expected the new feature.
Recommendation: (a).
Challenges: "old workspace.* roles keep working during migration".

## Q21 [Impl] How do the checkout store's single-flight and GC locks work across hosts?
Single flight uses an in-process map and a lock file keyed by pid with a heartbeat. A pid is meaningless between hosts, the map does not coordinate instances, and hardlink counting, rename atomicity and link limits behave differently on network filesystems. The blob GC rule relies on a link count of one.
Example scenario: Two instances build the same checkout; GC on a third deletes a blob whose link count looked like one because the other link was not yet visible over NFS.
Options: (a) PostgreSQL advisory locks and build rows for coordination; (b) lock files with host id and heartbeat; (c) a single designated builder. Trade-off: (c) is a single point of failure.
Recommendation: (a).
Challenges: "N BFF instances required"; plan assumes one BFF.

## Q22 [Impl] Is the Docker socket in the BFF acceptable when both Docker and Kubernetes runners are required?
Overlay volumes, helper containers and job launches depend on Docker volume options and a mounted Docker socket, which is root on the host. Kubernetes offers no equivalent of those volume drivers, so the runner interface leaks. The deployment target is undecided, which means the abstraction may be designed for neither.
Example scenario: A BFF remote-code-execution bug lets an attacker start a privileged container mounting the host root and reading every repository.
Options: (a) a separate runner service with a narrow API holding the socket; (b) rootless runtimes; (c) socket in the BFF. Trade-off: (a) adds a component but shrinks blast radius.
Recommendation: (a).
Challenges: "Docker+Kubernetes runners behind one runner interface".

## Q23 [Domain] Can we prove the pinned commit is exactly the data a job ran on?
A Pin is a commit; the checkout is built from blobs hashed by SHA-256 against oxen's XXH3 listing. Scrub verifies a rotating 5% weekly, so full coverage needs about twenty weeks, and corrupt checkouts are only marked after detection. A validated analysis can therefore mount bit-rotted data.
Example scenario: A blob rots in week 3; a regulated analysis runs in week 5, is committed, and the problem is discovered in week 17.
Options: (a) verify the checkout manifest and sampled content at build and at mount; (b) full scrub within days; (c) as planned. Trade-off: (a)/(b) cost IO.
Recommendation: (a) at mount for pinned jobs and (b) at cadence of days.
Challenges: Scrub design; SHA-256 authoritative.

## Q24 [Domain] Who may delete a workspace and the evidence in it?
Deleting a workspace needs only repo write and removes upper, work and the volume with no recovery. Failed-job outputs are the evidence for deviation and OOS investigations, and the owner decided retention is forever elsewhere. The two decisions conflict.
Example scenario: During an investigation a colleague with write deletes the workspace holding the failed run's output.
Options: (a) delete restricted to owner or maintain, with a hold flag set by quality roles; (b) soft delete for N days; (c) keep. Trade-off: (b) uses disk but is recoverable.
Recommendation: (a)+(b).
Challenges: "failed-job outputs stay in workspace"; "retention forever".

## Q25 [Impl] How can fencing, overlay and multi-instance behaviour be tested at the HTTP boundary?
The owner chose tests at the BFF HTTP boundary against real containers, and the spike only ran on Docker Desktop. Kernel overlay behaviour, hardlink semantics and network filesystem quirks cannot be seen through HTTP responses and differ between macOS and Linux. Fencing needs killing and pausing instances.
Example scenario: All tests pass on a Mac laptop, and production on an NFS-backed Linux cluster refuses to mount.
Options: (a) a Linux CI environment mirroring production with chaos tests (pause, kill, partition); (b) macOS only; (c) fake the filesystem. Trade-off: (a) costs infrastructure.
Recommendation: (a).
Challenges: "Filesystem-level behaviour is tested through the API"; "spike verified Docker Desktop only".

## Q26 [Impl] How are laptop jobs that hold a server lease kept safe?
A laptop job takes a write lease through the BFF, runs locally, uploads a tar and removal list that the server applies. Laptops sleep, lose network and run in unqualified environments, and extraction of a client tar is an attack surface. Fencing must apply to the final apply, not just to the lease.
Example scenario: A laptop sleeps for ten hours; the lease expires and another writer starts; the original wakes and uploads its tar.
Options: (a) apply checks the fencing generation and rejects stale uploads; (b) extraction limits on size, count and paths; (c) trust the holder. Trade-off: (a) loses the laptop's work.
Recommendation: (a)+(b), and offer saving the rejected tar to the user.
Challenges: Local-job decision D7.

## Q27 [Impl] Is a single UID for every workspace and blob an acceptable tenant boundary?
All store and workspace files are owned by one UID and blobs are deduplicated across repositories and namespaces. Any container escape or mount misconfiguration exposes everything, and dedupe leaks existence information. Regulated namespaces may demand isolation.
Example scenario: A job in repository A escapes its container and reads the confidential blobs of repository B which share the same UID and store.
Options: (a) per-namespace UID ranges; (b) per-namespace stores without cross-dedupe for regulated namespaces; (c) one UID. Trade-off: (b) costs disk.
Recommendation: (a) with (b) for regulated namespaces.
Challenges: Storage layout.

## Q28 [Domain] How do Stages and Workspaces coexist for users and in the record?
Users now see Stages (Oxen server-side) and Workspaces (Mice overlay), with different favorites id grammars and Sessions restricted to commit-pinned snapshots. Scientists will confuse them, and SOPs written against one will be applied to the other.
Example scenario: A scientist stages a file into a Stage and expects the next job to see it, but jobs only see Workspaces.
Options: (a) distinct docs, UI labels and a visible type on every id; (b) merge concepts; (c) retire Stages. Trade-off: (c) loses function.
Recommendation: (a), with Stages scheduled for review once Workspaces ship.
Challenges: "stage naming/authz migration".

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Spike on real target FS first (still UNRESOLVED); candidate reflink/copy on shared FS, node-local upper as optimization | answered |
| Q2 | Workspace = transient with stated loss risk; successful job results auto-committed to a branch; interim upper backup once backup exists | answered |
| Q3 | Failed-job output committable only on acknowledgement; commit+lineage carry failure state | answered |
| Q4 | Controller kills old container before new lease; unreachable node => refuse | answered |
| Q5 | DB time for expiry; force-release stops holder first with confirmation | answered |
| Q6 | Inherited: no direct main writes; approval via merge (05 Q11) | answered |
| Q7 | Automated job commits never signed; 'unsigned/pending' in lineage; merge to main needs human signature | answered |
| Q8 | Postgres operation journal authoritative; reconciler reads journal then oxen | answered |
| Q9 | Inherited: static repo names, no copy rename (05 Q25) | answered |
| Q10 | Snapshot refresh or helper via writer mount; no second overlay mount | answered |
| Q11 | Re-authorize at each renewal and commit; terminate lease on denial, output kept, commit blocked | answered |
| Q12 | FS project quotas + controller hard-ceiling kill keeping output | answered |
| Q13 | Commit fails unless skipped entries acknowledged (on Outcome); in-tree symlinks as manifest entries | answered |
| Q14 | Incremental size+mtime scans, full hash at commit, no overlapping scans, stated freshness | answered |
| Q15 | Discarded 'theirs' files preserved on safe branch/hold area | answered |
| Q16 | Conflict detail in Postgres; digest + counts in audit event | answered |
| Q17 | Users stop own sessions only; others notified w/ grace; audited Maintain override | answered |
| Q18 | Lease renewals a documented exception to per-event Intent (summarised in lease Outcomes); TTL > tolerated audit outage. Conflict with 00 Q3 'absolute' noted — needs ADR | answered |
| Q19 | Severity tiers: immediate for stuck/critical, daily digests for low-severity | answered |
| Q20 | Inherited: new project | answered |
| Q21 | Postgres advisory locks + build rows | answered |
| Q22 | Separate runner service holds Docker socket/K8s creds; BFF never mounts | answered |
| Q23 | Verify at build and at mount for pinned jobs; full scrub within days | answered |
| Q24 | Delete by owner/Maintain; quality hold flag; soft delete N days | answered |
| Q25 | Linux CI mirroring prod FS with chaos tests | answered |
| Q26 | Fencing check rejects stale uploads (offer saving tar) + extraction limits | answered |
| Q27 | Per-namespace UID ranges + per-namespace non-deduped stores for regulated namespaces | answered |
| Q28 | Distinct docs/labels, visible id type; Stages reviewed after Workspaces ship | answered |

---

# Known Issues and Conflicts

## Overlay spike unresolved (BLOCKER)
- **Q1 (spike still UNRESOLVED)**: BLOCKER for Workspaces on Kubernetes (16 Q7) and production readiness. Linux overlayfs does not support NFS/CephFS as upperdir. Spike must decide: reflink/copy on shared storage, node-local upper with sync, or fallback copy/node-local scratch. Without spike resolution, Kubernetes Workspaces cannot be implemented. Fallback: copy or node-local scratch severely degrades multi-instance sharing.

## Lease renewal audit strict decision
- **Q18 (RESOLVED strict: no aggregation)**: Every renewal has Intent/Outcome. No exception to absolute fail-closed (authentication round 6 S1). CONSEQUENCE: high audit event volume. If immudb is down, lease expires and work stops at expiry. Capacity-plan immudb for renewal load (every few seconds per active Workspace). Size lease TTL and renewal rate accordingly.

## Interim backup dependency
- **Q2 (interim upper backup depends on backup existing)**: Workspace content is transient with stated loss risk (Q2). Successful Job results auto-committed to branch. Interim upper backup once backup exists. Backup is a hard start gate (04 Q16); the interim state must not run in regulated use until backup is operational.

## Unsigned automated commits and review gate
- **Q7 (automated commits never signed) and 00 Q19**: Jobs and automated Workspace commits are unsigned. Lineage shows unsigned/pending. Merge to main needs a human maintainer signature (05 Q11, 04). No auto-merge (09 Q6); result stays on safe branch. Automated commits attributed to submitting Principal + "performed by Job <id>" (authentication T2). Named responsible human owner needed on event (Q7/00 Q19).

## Conflict detail storage outside immudb
- **Q16 (conflict detail in Postgres, outside immudb) versus 03**: Conflict detail (type, three hashes, choice, chooser per path) lives in Postgres. Audit event carries digest + counts only. Retention of Postgres conflict detail not set. Interacts with 03 (Audit) – evidence split across stores. Digest makes detail tamper-evident (Q16).

## Notification tier alignment
- **Q19 (notification severity tiers) versus 14 Q18**: Must align with heartbeat-based stuck detection in 14. Immediate for stuck/critical; daily digests for low-severity. 14 defines notification recipients and escalation; 08 defines severity tiers.

## Stages review deferred
- **Q28 (Stages distinct docs/labels reviewed after Workspaces ship)**: DEFERRED. Stages (Oxen workspaces) and Workspaces (Mice overlay) coexist. Distinct docs and labels planned (Q28). Full review and rename strategy deferred until Workspaces are live. Naming collision risk during migration period.

## Soft delete only, no erasure
- **Q23 and Q24 versus 00 Q8 (no erasure)**: Soft delete only. No hard delete. Workspace residue kept until retention period or legal hold expires. Any erasure out of scope. Aligns with 00 Q8 (no erasure, GDPR subordinate to GxP).

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 09 (Jobs)**: Jobs mount Workspaces (09 depends on 08 for mount). Failed-job output (Q3/09 Q5) stays in Workspace. Dirty Workspace refused (Q26/09 Q26). Lease fencing (Q4/09 Q4, Q22/09 Q22). Kubernetes runner unsupported until spike (Q1/09 Q11).
- **Blocks 10 (Sessions)**: Desktop Sessions mount Workspaces read-only or with write lease. Concurrent-create race (10 Q13 accepted). Guest outside-mount data loss (10 Q21 accepted). Single RW session per Workspace (compensating control for no recording, 10 Q4/04 Q22).
- **Blocks 08 (Workspaces) internal**: Lease (Q4, Q5), fencing (Q4, Q26), quotas (Q12), commit (Q3, Q7, Q8, Q13), conflicts (Q15, Q16), and integrity (Q23) define Workspace lifecycle.

## Depends on
- **Depends on 00 (Cross-cutting)**: Absolute fail-closed (Q18/00 Q3). No erasure (Q24/00 Q8). Static repo names (Q9/05 Q25). Unsigned automated commits (Q7/00 Q19).
- **Depends on 01 (Authentication)**: Re-authorize at renewal and commit (Q11/authentication Q71). Revoke terminates lease (Q11/01 Q20). Step-up for signing (01 Q8/04 Q6).
- **Depends on 02 (Authorization)**: AuthZ re-check at renewal (Q11/02 Q14). Delete by owner/Maintain (Q24). Elevation with reason (Q17/02 Q8).
- **Depends on 03 (Audit)**: Intent/Outcome per renewal (Q18/03 Q18). Conflict detail digest in audit (Q16/03 Q16). Compensating Outcome (Q8/03 Q9). Lease renewals (Q18/authentication S1).
- **Depends on 04 (GxP Compliance)**: Automated commits unsigned (Q7/04 Q7). Legal-hold (Q17/04 Q15). Backup as start gate (Q2/04 Q16). Merge needs human signature (Q7/04).
- **Depends on 05 (Repositories)**: Static repo names (Q9/05 Q25). Rename refused while leases exist (05 Q28/09 Q28). Merge to main (Q6/05 Q11).
- **Depends on 16 (Operations)**: Kubernetes production target (Q1/16 Q1). Backup (Q2/04 Q16/16 Q2). Separate runner service (Q22/16 Q8).

## Cross-cutting impacts
- **00 (Cross-cutting)**: Lease renewal exception to Intent-before-mutation (Q18/authentication S1 resolved as strict, no aggregation). Unsigned automated commits (Q7/00 Q19). Static names (Q9/00 Q7 superseded).
- **01 (Authentication)**: Re-authorize at renewal (Q11/authentication Q71). Revoke terminates lease, blocks commit (Q11/01 Q20). Step-up for signing workspace merge (01 Q8).
- **02 (Authorization)**: Re-check at renewal (Q11/02 Q14). Delete permission (Q24). Maintain override (Q17/02 Q8).
- **03 (Audit)**: Lease renewals (Q18/authentication S1, 03 Q18). Conflict detail (Q16/03 Q16). Compensating Outcome (Q8/03 Q9). Postgres operation journal (Q8).
- **04 (GxP Compliance)**: Automated commits unsigned (Q7/04 Q7/authentication T2). Legal-hold (Q17). Backup (Q2/04 Q16).
- **05 (Repositories)**: Static names (Q9/05 Q25). Workspace survives rename. Merge to main (Q6/05 Q11).
- **09 (Jobs)**: Jobs mount Workspaces. Failed output in Workspace (Q3/09 Q5/04 Q12). Dirty refused (Q26/09 Q26). Lease fencing (Q4/09 Q4/Q22). Kubernetes unsupported (Q1/09 Q11).
- **10 (Sessions)**: Desktop Sessions mount Workspaces. Single RW session (compensating control, 10 Q4). Concurrent-create race (10 Q13). Guest data loss (10 Q21).
- **11 (Lineage)**: Workspace commits create lineage edges. Failed-job state in commit/lineage (Q3/09 Q5).
- **14 (Notifications)**: Severity tiers (Q19/14 Q18). Stuck operations (Q19). Lease contention (story 12).
- **16 (Operations)**: Kubernetes production (Q1/16 Q1). Backup (Q2/16 Q2). Runner service (Q22/16 Q8). Overlay spike (Q1/16 Q7).

