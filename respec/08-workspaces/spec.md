Status: needs-info
Blocked on: overlay-on-shared-filesystem spike; Q2/Q3/Q4/Q5 below (notification catalog alignment, conflict-detail retention, RPO/RTO, upper snapshot).

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
14. As an auditor, I want conflict resolution detail in audit, so that three-way updates are reconstructable.
15. As a user, I want Stages in the UI, CLI and favorites, so that Oxen workspaces have a distinct name.
16. As an admin, I want old `workspace.*` roles to keep working during migration to `stage.*`.

## Implementation Decisions

- Bulk tree state lives on a shared RWX filesystem; leases and generations in PostgreSQL.
- **Unresolved:** Linux overlayfs does not support NFS/CephFS as upperdir. Options: node-local overlay with workspaces pinned to a node; reflink/copy tree mode; node-local upper synced to shared storage at lease release. A spike must decide before implementation of W4.
- Fencing token: a generation counter in PostgreSQL checked by every mutation, plus the controller.
- Mutations are audited with Intent/Outcome and fail closed under strict.
- Stages naming and authz migration as in 02.
- Untrusted-tree rules, quotas and a file-count cap are retained.
- Conflict detail is recorded in audit; retention in the workspace is open.
- Backup/DR is deferred.

## Testing Decisions

- HTTP tests for leases, commit, merge, update conflicts and quotas; two BFF instances test fencing.
- Filesystem-level behaviour is tested through the API, not internal files.
- Prior art: TC-WS tests and the W0 spike harness.

## Out of Scope

Backup/restore, RPO/RTO targets, snapshotting a live `upper`.

## Further Notes

Spike on 2026-10 verified Docker Desktop overlay volumes only; shared-FS behaviour is untested.
