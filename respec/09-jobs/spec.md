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
13. As a service principal owner, I want automation to submit jobs as a service principal.

## Implementation Decisions

- Runner interface with Docker and Kubernetes implementations; both in this spec.
- No automatic retries, no `max_attempts`; each submission is its own JobRun.
- Re-attachment identifies executions by a label containing the job id.
- Failed-job outputs stay in the frozen Workspace; no separate download operation.
- Retention: until deleted.
- Stuck-job thresholds and recipients are decided in 14.
- `favorites=first` ordering is supported server-side (see 13).
- Depends on 08 for the mount mechanism.

## Testing Decisions

- HTTP tests of the job lifecycle with a fake runner at the interface and one Docker run in e2e.
- Prior art: existing Jobs Playwright smoke.

## Out of Scope

Automatic retry, backoff, outputs download for failed jobs.

## Further Notes

Kubernetes runner ownership of labels and pod identity needs design.
