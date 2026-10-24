# 09: ADR, plan updates, revocation runbook and CI

**What to build:** Record the decisions and make regressions block merges: an ADR for default-deny on unclassified paths, the authorization plan updated (Staging wording, single table, readiness checklist), a revocation runbook, and the TC-AUTHO tests running in CI.

**Blocked by:** 01, 02, 03, 04, 05

**Status:** done

- [x] ADR added under the docs ADR directory
- [x] Authorization plan uses Staging for Oxen's workspaces and states the repo-role floor for workspaces
- [x] Runbook describes revoke-by-`iss`+`sub` for stale group access
- [x] CI runs the auth test suite on pull requests
