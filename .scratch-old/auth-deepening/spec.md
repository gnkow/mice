Status: ready-for-agent

## Problem Statement

Maintainers of the Mice BFF auth module pay for shallow authorization modules. The same question ("may this Principal do this on this repo?") is decided in several places; audit and authorization each classify the same request path; permission checks silently run Principal bootstrap (which can write state); authorization state is reachable only through a file-backed store; and the proxy mixes six responsibilities so its ordering guarantees (deny before reject before upstream) are only testable with a real upstream. Every new route risks drift between audit, authorization and fine-grained roles.

## Solution

Deepen five modules without changing observable behaviour (ADR 0001 identity trust and ADR 0002 default-deny are preserved):

1. **Request interpretation module**: one interface turns `(method, pathname)` into everything known about the request: audit action, namespace, repo, detail, authorization action, minimum repo role.
2. **Repo action decision module**: one interface decides "Principal, repo, action" including role floor, fine grants and PAT cap; job, lineage and Mice Workspace checks become table entries.
3. **Principal preparation separated from decisions**: preparation (bootstrap admin, dev grant, group bootstrap) happens at authentication/login only; decisions are read-only.
4. **Persistence seam for JSON state**: file adapter in production, in-memory adapter for tests.
5. **Proxy orchestration seams**: request-body interpretation extracted; upstream transport injectable, so ordering is tested with a fake upstream.

## User Stories

1. As a maintainer, I want one place that classifies a request path, so that adding a route cannot desync audit and authorization.
2. As a maintainer, I want unknown paths to still deny, so that default-deny (ADR 0002) survives the refactor.
3. As an auditor, I want audit action labels unchanged, so that existing audit history stays comparable.
4. As a security reviewer, I want push/transport routes still authorized as `push` while audited as before, so that the intentional split stays visible in one table.
5. As a maintainer, I want the minimum role for any action to come from the same interpretation as its fine permission, so that custom roles cannot drift.
6. As a maintainer, I want job submit/read/cancel/complete checks to be table entries, so that a new job action is one line.
7. As a maintainer, I want Mice Workspace and lineage checks to use the same decision path, so that PAT caps apply identically.
8. As a PAT holder, I want my scope to cap every repo decision, so that a token never exceeds its scopes.
9. As an Instance admin, I want site-admin bypass to remain unavailable to scoped credentials, so that tokens never escalate.
10. As a Principal with a fine-grained custom role, I want it to grant actions below the role floor exactly as before.
11. As a security reviewer, I want authorization decisions to be read-only, so that a permission check never mutates instance state.
12. As an operator, I want bootstrap admin, dev grant-all and group bootstrap applied once at authentication and login, so that the first request still bootstraps correctly.
13. As a maintainer, I want a test proving a decision does not write instance state.
14. As a test author, I want an in-memory persistence adapter, so that policy tests need no temp directories.
15. As an operator, I want the file adapter to keep atomic writes, so that production persistence is unchanged.
16. As a maintainer, I want file layout hidden behind the persistence seam, so that a future multi-replica store is an adapter.
17. As a security reviewer, I want unauthorized callers to get 403 before body rejection (400), so that classification details do not leak.
18. As a security reviewer, I want the upstream never called after a deny or rejection, tested with a fake upstream.
19. As a maintainer, I want request-body interpretation (author injection, message, create target, lineage hints) in its own module, so that proxy orchestration is short.
20. As a maintainer, I want author injection to stay mandatory and fail-closed (ADR 0001).
21. As an auditor, I want site-admin bypass audit events and repo-create seeding to behave as today.
22. As a maintainer, I want existing auth tests to pass unchanged in behaviour, so that this is a safe refactor.

## Implementation Decisions

- Request interpretation module owns canonical path facts: audit classification (moved out of audit), authorization-only action override for push/transport, minimum role table, unscoped allowlist. Audit and authorization both consume it; audit keeps its labels.
- Repo action decision module exposes one entry taking Principal, namespace, repo and action name; a policy table supplies role floor, HTTP method used for fine-permission mapping and denial reason. Existing named helpers (job, lineage, workspace) are removed and callers move to the single entry. Behaviour including reason strings is preserved.
- Decision functions no longer call Principal preparation. Preparation stays in authentication (session and PAT), login and directory flows. Enforce state set by bootstrap is therefore established before any decision.
- Persistence seam sits at the JSON file read/write functions: a backend interface with a file adapter (default) and an in-memory adapter selectable by tests. Two adapters make the seam real.
- Proxy: body interpretation returns a plain result (body, headers, message, create target, lineage hints, rejection); upstream transport is injectable with the global fetch as default.
- No new env vars, no API or schema changes.

## Testing Decisions

- Good tests assert external behaviour (decision result, response status, audit action, whether upstream was called), not which helper was called.
- Seams: (a) request interpretation interface, table-driven over every route; (b) authorization entry points (`authorizeApiRequest`, repo action decision) on top of the in-memory adapter; (c) `proxyToOxen` with a fake upstream.
- Prior art: `authz.test.ts` (table completeness, PAT cap), `audit.test.ts` (classification), `pathCanonical.test.ts`, `startupGate.test.ts`.
- Each slice is red then green, one at a time.

## Out of Scope

- Changing role semantics, adding actions, or Phase 5 access lifecycle.
- Splitting the instance/namespace/membership parts of the authorization store beyond the persistence seam.
- Mice Workspace per-owner isolation.
- Work in the entry module and route modules owned by another agent.

## Further Notes

Derived from the architecture review of auth/authz. All five candidates approved in one go; not committed per request.
