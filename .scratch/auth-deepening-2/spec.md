Status: done (uncommitted)

## Problem Statement

After the first deepening round, maintainers still pay for: a second copy of credential resolution in the Mice Workspace routes (and direct session reads), an if-ladder in the API authorization entry that recognises routes a second time, the same "enforce off, instance admin, or named permission" rule re-implemented per instance action, a proxy that runs four policy effects inline after the upstream call, a 990-line authorization store that every module imports for one concern, and tests that depend on import order and process globals.

## Solution

Six deepenings, behaviour-preserving (ADR 0001 identity trust, ADR 0002 default-deny preserved):

1. **Request authentication**: every authenticated route, including Mice Workspace routes, resolves its Principal through the one authentication interface, which also prepares the Principal.
2. **Authorization state split by concern**: instance policy, namespace membership, repo collaboration, bootstrap and visibility each get their own module; the wide store module is deleted.
3. **Route-kind decisions**: request interpretation names the route kind; one policy table decides unscoped routes, leaving default-deny as the single fall-through.
4. **Post-upstream effects**: namespace-list filtering, repo-create seeding and the site-admin-bypass audit move into an effects module that takes the interpreted request, decision and upstream result.
5. **Instance permission policy**: a table maps instance-level actions to a named permission; the enforcement-off, admin and scoped-credential rules live once.
6. **Config and adapters**: remaining JSON documents go through the persistence seam, and configuration can be overridden explicitly in tests.

## User Stories

1. As a maintainer, I want Mice Workspace routes to authenticate through the shared interface, so that revocation and scope rules are fixed in one place.
2. As a security reviewer, I want PAT scope restrictions on workspace routes to match the rest of the BFF.
3. As an operator, I want first-request bootstrap to work whichever route is hit first.
4. As a maintainer, I want a single authentication matrix test (session, PAT, none, scoped PAT) so that route tests stop needing bespoke setup.
5. As a maintainer, I want instance admin, namespace membership and repo collaboration state in separate modules, so that a membership bug stays in membership.
6. As a caller, I want to import only the concern I use, so that I learn a small interface.
7. As a maintainer, I want the wide store module deleted, so that no new code reaches for "everything".
8. As a maintainer, I want unscoped routes (namespace list/detail/create, repo create/list) decided from one table, so that a new route kind is added once.
9. As a security reviewer, I want default-deny to remain the single fall-through for unknown routes.
10. As a maintainer, I want request interpretation to name the route kind, so that routes are not recognised twice.
11. As a maintainer, I want repo-create seeding, namespace-list filtering and bypass auditing tested with a fake upstream result, so that I need no full proxy request.
12. As an auditor, I want the site-admin-bypass audit event and audit/lineage output unchanged.
13. As a maintainer, I want one policy table for instance actions (audit view, lineage view, own tokens, CLI device approve, store admin), so that adding one is one line.
14. As a security reviewer, I want scoped credentials never to gain instance-admin bypass, tested once in a matrix.
15. As a test author, I want configuration overridable without import-order tricks.
16. As a test author, I want every JSON document behind the persistence seam, so that policy tests need no temp directories.
17. As an operator, I want persistence format and atomic writes unchanged.
18. As a maintainer, I want all existing auth tests to keep passing.

## Implementation Decisions

- Mice Workspace routes call the shared authentication interface with a policy allowing PAT credentials; their local copy is removed. Behaviour (session first, then bearer PAT, 401 otherwise) is preserved.
- Authorization state modules share one low-level reader/writer layer over the persistence seam; the split follows the four concerns and callers import the concern they need.
- Request interpretation additionally returns a route kind (namespace list, namespace detail, namespace create, repo create, repo list, repo-scoped, other). Authorization looks the kind up in a decision table.
- Instance permission policy is a table from action to permission name, with the rules for enforcement-off, instance admin and scoped credentials applied once. Existing denial reasons are preserved.
- Post-upstream effects module takes the interpreted request, the Principal, the decision and the upstream response and returns the final body; the proxy only forwards.
- Configuration gets an explicit override hook for tests; production still reads the environment once at startup. Fully file-bound modules (data-dir lock, workspace checkouts) stay on the filesystem.

## Testing Decisions

- Good tests assert external behaviour: decision results, response status and body, audit actions.
- Seams: the authentication interface (matrix), the authorization entry points on the in-memory adapter, route-kind interpretation (table-driven), the effects module with a fake upstream result, and the instance permission matrix.
- Prior art: `requestInterpretation.test.ts`, `repoAction.test.ts`, `proxyOrdering.test.ts`, `jsonStore.test.ts`.

## Out of Scope

- Role semantics, Phase 5 lifecycle, Mice Workspace per-owner isolation.
- Converting file-bound modules (data-dir lock, checkout trees, job runners) to the persistence seam.
- Changes to the entry module owned by another agent beyond import updates.

## Further Notes

Round 2 of the auth/authz architecture review; all six approved at once, not committed per request.
