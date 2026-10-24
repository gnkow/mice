Status: ready-for-agent

# AUTHZ production readiness (PLAT-AUTHO)

## Problem Statement

The authorization model (namespace and repo roles, enforced at the BFF) is built and unit-tested, but a production deployment can still run open. Enforcement is off until the store flag is set, dev grant-all can leak into production, unrecognised GET paths are allowed for any non-pending Principal, the role map is documentation rather than the enforced table, and oxen-server is published on the host by default. Operators cannot trust that "AuthZ is on" means "everything is gated".

## Solution

Make the BFF fail closed in production: refuse to start unless authorization is enforced and safely configured, derive every decision from one classified path table, deny anything unclassified or non-canonical, keep oxen-server reachable only from the BFF, and pin the behaviour with tests at the BFF HTTP boundary.

## User Stories

1. As an operator, I want the BFF to refuse to start in production unless authorization is enforced, so that a missing setting cannot leave the platform open.
2. As an operator, I want startup to fail when no bootstrap admin is configured, so that the instance cannot be unmanageable or silently ungated.
3. As an operator, I want startup to fail when dev grant-all or dev mode is set in production, so that dev shortcuts cannot reach production.
4. As an operator, I want the store `enforce` flag ignored in production, so that editing a data file cannot turn authorization off.
5. As an operator, I want startup to fail when the data directory is not writable, so that grants are never silently lost.
6. As an operator, I want a second BFF replica to refuse to run against the same data directory, so that single-writer JSON stores are not corrupted.
7. As an operator, I want oxen-server unpublished in the base compose file, so that the default deployment has no path around the BFF.
8. As an operator, I want startup to fail when the oxen upstream address is a public or published address, so that misconfiguration is caught early.
9. As a developer, I want a dev-only compose override that publishes oxen-server for e2e helpers, so that tests keep working without weakening the base file.
10. As a Principal, I want unrecognised GET paths denied unless explicitly allowlisted, so that new oxen routes cannot leak data.
11. As a Principal, I want path variants (case, encoded separators, dot segments, double slashes) rejected, so that what is authorised is exactly what is proxied.
12. As a Principal with the Write role, I want to push commits through the BFF, so that my role matches the intent of Write.
13. As a maintainer, I want every proxied route classified in one table that drives enforcement, so that the documentation cannot drift from behaviour.
14. As a maintainer, I want CI to fail when a reachable route is unclassified, so that gaps are found before release.
15. As an auditor, I want a namespace Owner's audit query limited to their namespace, proven by a cross-namespace test, so that Owners cannot see other tenants.
16. As a PAT holder, I want my token limited to the intersection of its scopes and my current direct grants, so that losing access takes effect immediately.
17. As an administrator, I want a documented runbook for revoking a Principal's credentials after IdP group removal, so that stale group access can be cut off until Phase 5 lands.
18. As a reviewer, I want an ADR recording default-deny on unclassified paths, so that the decision survives staff turnover.
19. As a maintainer, I want the TC-AUTHO tests running in CI, so that regressions block merges.

## Implementation Decisions

- Single seam: the BFF HTTP boundary, plus the startup configuration validator. No new seams.
- Production startup validator extends the existing production gate (hardening issue 08): requires enforcement on, at least one bootstrap admin, no dev mode or dev grant-all, and a writable persistent data directory. It also rejects an oxen upstream that is a published or public address.
- In production the enforcement toggle is not a runtime switch: the environment override and the store flag cannot disable it. Outside production the current behaviour is unchanged.
- One path table (method, path pattern, minimum role or action) drives both the decision and the documentation; the plan's role matrix is generated from or checked against it.
- Unscoped or unrecognised GET/HEAD paths are denied unless on an explicit allowlist: version, health, oxen version, namespace list and namespace detail. Unknown mutating routes stay admin-only.
- Request paths are canonicalised once before classification and forwarding; non-canonical paths get 400 and the canonical form is what is proxied.
- Push-related routes (commit upload, commit publish, version chunks) are classified as Write. Behaviour is first proven with a Write-collaborator push test.
- Oxen isolation is by network only: internal network, no host port in the base compose, dev override for e2e. No sidecar, no mTLS, no shared secret in v1.
- Single-replica guard via a lock in the data directory; JSON writes are already atomic.
- PAT authorization is the intersection of scopes and the minting user's current direct grants; group-derived access stays fixed at mint until revocation.
- Workspace and Staging access stays at the repo-role floor (read for GET, write for mutations). Per-feature rules are decided in the owning feature plans, not here.
- An ADR records default-deny on unclassified paths; the authorization plan is updated (Staging wording, single table, readiness checklist).

## Testing Decisions

- Test external behaviour only: request in, allow/deny and upstream-called or not out; startup validator input to accept/reject.
- Modules tested: authorization decision and path table, startup validator, audit scoping, PAT authorization, lock guard.
- Prior art: the existing authorization test matrix (TC-AUTHO-01 to 14), route guard tests, PAT scope tests and audit tests under the auth service.
- A table-completeness test enumerates proxied routes and fails on unclassified ones.

## Out of Scope

- Phase 5 features: revocation UI, access-review campaigns, breakglass expiry.
- Per-owner isolation of Staging and Mice Workspaces; sidecar, mTLS or signed requests between BFF and oxen-server; a database for stores; service principals; live directory re-checks.

## Further Notes

- Oxen's own workspaces are called Staging in the glossary; Mice Workspaces are the overlay trees. Use those terms.
- Until Phase 5, the supported route for dropping group-derived access is admin revoke by `iss`+`sub` (rejects PATs created at or before the cut-off).
