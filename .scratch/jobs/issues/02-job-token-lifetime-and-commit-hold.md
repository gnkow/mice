Status: ready-for-agent

# 02: Job token lifetime and commit hold

**Spec:** `.specs/09-jobs.md` (Results, audit and lineage)

**Blocked by:** 01

Moved from `.scratch/authentication/issues/36-job-token-lifetime-and-commit-hold.md`. The submitter's `author` and `email` follow authentication issue 08. The result-commit line that names this token is issue 01.

## What to build

A job token lasts only for that job's maximum runtime. At commit, the BFF re-checks the submitting Principal with the IdP. A disabled or revoked submitter blocks the commit. When the IdP cannot be reached, the commit stays in finalizing until the IdP returns or the retention window ends. It is never auto-approved. The job may finish running; only the result commit is blocked.

## In code today

`createJobToken` accepts a `durationMs` argument and returns an in-memory token. Nothing in the job runner calls it, and no commit finalizing state waits on the IdP.

## Acceptance

- [ ] The job token expiry equals the job's configured maximum runtime
- [ ] Commit checks the submitter against the IdP and blocks the commit when the submitter is disabled or revoked
- [ ] An unreachable IdP leaves the commit in finalizing
- [ ] The commit is not approved while the IdP is unreachable
- [ ] The held commit completes when the IdP returns and the submitter is enabled, or ends when retention ends
