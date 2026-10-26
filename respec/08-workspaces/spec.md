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
