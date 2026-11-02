Status: ready-for-agent

# 01: Job commit attribution

**Spec:** `.specs/09-jobs.md` (Results, audit and lineage)

**Blocked by:** none

Moved from `.scratch/authentication/issues/21-job-commit-attribution-trailer.md`. The submitter's `author` and `email` follow authentication issue 08. Binding the job token to the job's maximum runtime, and holding the commit when the IdP is down, is issue 02.

## What to build

A job commit uses the submitting Principal the same way authentication issue 08 uses a human Principal. `author` is that Principal's canonical `iss|sub`. `email` is that Principal's email at job submission. The message ends with one trailer line:

`Job: <job id>, Token: sha256:<hash>`

The BFF strips any client-supplied `Job:` line first. A human commit does not get this line. The trailer is attribution, not a signature. Jobs cannot sign.

## In code today

`appendJobAttribution` and `appendJobAttributionFromToken` format a line that also includes `Submitted-by` and a name, and the token hash is truncated to 16 hex characters. `stripIdentityTrailers` removes a client-supplied `Job:` line. `canElectronicallySign` rejects a job principal. No job commit path calls the formatter. Server-side job commits in `jobs.ts` pass `job.actor.name` and `job.actor.email` straight to oxen. Human commits through the proxy already store canonical `iss|sub` as `author` and the current email as `email`, and leave the message unchanged.

## Acceptance

- [ ] A job commit's `author` is the submitting Principal's canonical `iss|sub`
- [ ] A job commit's `email` is the submitting Principal's email at job submission
- [ ] The job commit path appends the single-line trailer with the job id and the token hash
- [ ] A client-supplied `Job:` line is removed before the BFF trailer is appended
- [ ] A human commit path does not append the `Job:` line
