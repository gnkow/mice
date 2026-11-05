Status: ready-for-agent

# 02: Job token lifetime and commit refusal

**Spec:** `.specs/09-jobs.md` (Results, audit and lineage)

**Blocked by:** 01

Moved from `.scratch/authentication/issues/36-job-token-lifetime-and-commit-hold.md`. The submitter's `author` and `email` follow authentication issue 08. The result-commit line that names this token is issue 01.

## What to build

A job token lasts only for that job's maximum runtime. At commit, the BFF re-checks the submitting Principal with the IdP. A disabled or revoked submitter blocks the commit. When the IdP cannot be reached, the commit is refused and the job reports failure; there is no finalizing state and no held output (spec 04: mutations are refused, nothing is saved). The user resubmits. The job may finish running; only the result commit is blocked.

## In code today

`createJobToken` accepts a `durationMs` argument and returns an in-memory token. Nothing in the job runner calls it.

## Acceptance

- [ ] The job token expiry equals the job's configured maximum runtime
- [ ] Commit checks the submitter against the IdP and blocks the commit when the submitter is disabled or revoked
- [ ] An unreachable IdP refuses the commit, audited, and the job reports failure
- [ ] The commit is never approved while the IdP is unreachable
- [ ] No finalizing state or retention window exists; resubmission is the only recovery
