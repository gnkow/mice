# 21: Job Commit Attribution Trailer (U6)

**What to build:** Job commits carry an attribution trailer in the commit message: "Job: J-1234, Submitted-by: iss|sub, Token: hash". This ensures repository-level attribution even if audit logs are separated from the repository.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Job token includes submitter iss|sub, job ID, token hash in its claims/payload
- [ ] Commit author injection (BFF → oxen) includes Job attribution trailer for Job-originated commits
- [ ] Trailer format: "Job: J-1234, Submitted-by: alice|idp.example.com|12345, Token: sha256:abc123..."
- [ ] Human commits have iss|sub trailer only (no Job marker)
- [ ] Trailer appended to commit message body (after user-provided message, separated by blank line)
- [ ] Tests for Job commit trailers, human commit trailers (distinct formats), trailer parsing

## Context

Round 8 decision U6 addresses Q10/Q28 conflict. Human commits have iss|sub trailers; Job commits previously had no trailer (attribution via audit `via` only). Part 11 §11.50(a) requires signed records contain "the name of the signer." For Jobs, this means attribution must be in the repository itself, not just audit.

The trailer is NOT a signature (Jobs never sign), but ensures attribution persists with the repository history.
