Status: ready-for-agent

# 09 — Versioned jobs (PLAT-JOB)

## Problem Statement

Scientists need to run containers against a pinned Oxen commit with lineage and an optional result commit, on Docker or Kubernetes, without unsafe host access.

## Solution

A Job API and runner interface with Docker and Kubernetes implementations. Each Job is pinned, mounts a Workspace, logs, and optionally commits results. No automatic retries; users resubmit.

## User Stories

1. As a scientist, I want to submit a job against a commit, so that results are reproducible.
2. As a scientist, I want to see logs live and after completion, so that I can debug.
3. As a scientist, I want to cancel a job, so that I stop wasted compute.
4. As a scientist, I want to resubmit a failed job, so that I retry deliberately.
5. As a scientist, I want outputs from failed or cancelled jobs to remain in the workspace, so that I can inspect them without a special download.
6. As a scientist, I want an optional result commit with lineage to inputs, so that outputs are traceable.
7. As an auditor, I want job submit, start, finish and fail audited, so that compute is accountable.
8. As an operator, I want to run jobs on Docker or Kubernetes behind one interface, so that deployments differ only by runner.
9. As an operator, I want a restarted BFF to re-attach running jobs by a job-id label, so that they are not orphaned.
10. As a security reviewer, I want the Docker runner not to be the only option, so that the Docker socket is not mandatory.
11. As a repository admin, I want to see and cancel jobs in my repositories.
12. As a user, I want stuck jobs flagged and notified, so that I notice.
13. As an operator, I want jobs to run under BFF-internal job tokens tied to the submitting human, so that no service principal exists.

## Implementation Decisions

- Runner interface with Docker and Kubernetes implementations. Kubernetes is the production target (16 Q1) but is unsupported until the overlay-on-RWX spike (08 Q1) passes; the interim is a read-only dataset mount plus a small writable output volume.
- No automatic retries, no `max_attempts`; each submission is its own JobRun.
- Re-attachment identifies executions by a label containing the job id, with lease adoption by attempt nonce.
- Failed-job outputs stay in the frozen Workspace; no separate download operation.
- Retention: JobRun metadata is kept forever; logs and residue have configurable retention, legal hold and namespace overrides. No hard delete.
- Stuck-job detection is a single DB-leased detector on a queued threshold only; recipients are decided in 14.
- `favorites=first` ordering is supported server-side (see 13).
- Depends on 08 for the mount mechanism.

## Testing Decisions

- HTTP tests of the job lifecycle with a fake runner at the interface and one Docker run in e2e.
- Prior art: existing Jobs Playwright smoke.

## Out of Scope

Automatic retry, backoff, outputs download for failed jobs, service principals and CI submission, `input_globs`, jobs on a dirty Workspace.

## Further Notes

Kubernetes runner ownership of labels and pod identity needs design.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Scheduling and runner
- Claim with row locking and a heartbeat lease; global cap enforced in the claim transaction (Q3).
- Lease adoption with an attempt nonce; the runner refuses to commit if the lease generation changed (Q4).
- Cancel is a database state transition; 409 once committing (Q14).
- Per-user cap, resource units and an admin priority class; Kubernetes queueing later (Q21).
- Kubernetes unsupported until the overlay spike; interim read-only dataset mount plus small writable output volume (Q11).
- Single DB-leased stuck detector, queued-threshold only, no silence detection (Q20).

Images, inputs and secrets
- Image resolved to a digest at submit; both stored; digest-only execution; digest in the Intent (Q7).
- Approved-image catalogue enforced; catalogue entry id on the JobRun (Q8).
- Secret references only; detect-and-block; no user credential in the container (Q15).
- Input tracing by an in-container tracer (eBPF or preload) per runner; needs a spike and has privilege implications (Q1).
- `input_globs` dropped entirely (Q2).
- Jobs are refused on a dirty Workspace, always (Q26).

Results, audit and lineage
- Hold the result and retry the Intent in a visible "finalizing" state; Intent at submit and at finalize (Q9).
- Execution status and delivery status are split; the Outcome carries both (Q27).
- Log SHA-256 plus head/tail in the Outcome; full log durable; `log_truncated` marker (Q16).
- Normalised job-file table, counts and manifest hash on the JobRun; lineage is the single edge store (Q24).
- Opaque unique ids, never reused (Q18).
- JobRun metadata forever; logs and residue under configurable retention with legal hold (Q17).
- Leaving a Workspace resubmits as UNLINKED (Q23).

Testing
- Fault-injection runner, nightly real Docker and kind, two-instance tests (Q25).

## Conflicts and open risks

- Q23: resubmits are UNLINKED; RISK of "testing into compliance" not being visible; flagged for QA review.
- Q1: tracer needs a spike; privileges may conflict with Kubernetes hardening and the restricted runner proxy (16 Q8).
- Q11 versus 16 Q1: production is Kubernetes yet the Kubernetes runner is unsupported until the 08 spike; fallback is copy/node-local scratch. PENDING.
- Q20 versus 14 Q18: 09 uses queued-threshold only, 14 uses heartbeat-based stuck detection; align the two.
- Q13/Q19 and 01: service principals removed; CI unsupported; 12-14 and 00 Q19 must reflect BFF-internal job tokens.
- Q6 and 08 Q7: automated commits never signed; merge to main needs a human signature.
- Q21: priority class and Kubernetes queueing are DEFERRED.
- Q17: lineage and legal-hold interplay with 00 Q8 (no erasure) relies on legal sign-off.
