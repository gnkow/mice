Status: done (uncommitted)

## Problem Statement

A comprehensive scan after two deepening rounds found remaining friction for maintainers of Mice auth and authorization:

- About fifteen modules (session admin, namespace routes, service principals, access requests, index) decide admin, permission and role outcomes themselves, with ad hoc reasons and status codes; the scoped-credential rule is repeated in three places.
- The authorization state split left raw readers and writers exported; namespace create and delete write four documents separately and delete skips the last-owner invariant.
- The entry module (about 1,000 lines) starts the server on import, holds real feature handlers, and cannot be built in a test.
- Four route modules authenticate by hand, bypassing the route guard; error shapes and audit emission differ per file.
- The proxy interleaves forwarding, lineage capture, audit and response buffering.
- Credential resolution mixes storage, policy and write-on-read; a global hook list leaks effects into authentication; the device flow stores the raw token and keeps its throttle in memory.
- The OIDC provider and the directory keep process-global state and read config from the environment.
- Six JSON and JSONL stores re-implement parsing, corruption handling, migration and (not) transactions.
- Offboarding, job rekeying and namespace deletion are multi-step cascades with no single owner.
- 47 of 51 auth test files rely on import-time environment and temp directories, copy helpers, and use real sleeps.
- The web and CLI copy permission and role names from the server.
- E2E and CI do not cover deny paths; one plan points at a deleted module.

## Solution

Twelve behaviour-preserving deepenings (ADR 0001 identity trust and ADR 0002 default-deny preserved):

1. **Test support**: one shared test-support module (isolated environment, memory backend, principals, cookies, app helper) plus clock and provisioner seams.
2. **Authz repository**: one module owns authz persistence and exposes domain operations and snapshots; namespace create and delete become atomic with the last-owner rule.
3. **Authorization decisions**: one typed Decision interface covers every instance, namespace and session decision; routes only translate decisions to HTTP.
4. **Route entry**: the route guard also parses JSON, shapes errors and audits; every native route enters through it.
5. **App composition**: `createApp(deps)` builds the HTTP app with no side effects; a boot adapter owns migration, schedules, locks and serving; feature handlers move into route modules.
6. **Proxy capture**: lineage capture sits behind its own before/after interface; the proxy forwards.
7. **Credentials**: a credential-store seam, pure resolution policy, injected authentication observer, and a device-authorization state machine with an injectable clock and no persisted raw token.
8. **Adapters**: an OIDC provider interface and a Directory interface with explicit config and real and fake adapters.
9. **Stores**: a JSONL log interface and a transactional document interface over the existing persistence seam.
10. **Lifecycle**: offboarding, job rekey and namespace delete each have one owner with explicit failure semantics.
11. **Contract**: one authz contract module validated by the web and CLI adapters.
12. **Deny-path e2e and docs**: a small deny-path e2e set wired into CI; doc pointers fixed.

## User Stories

1. As a maintainer, I want one place to read an authorization decision for any action, so that I can audit policy without opening fifteen modules
2. As a maintainer, I want every denial to carry the same status and reason shape, so that clients and logs agree
3. As a security reviewer, I want the scoped-credential rule defined once, so that no route can forget it
4. As a security reviewer, I want every native route to enter through the guard, so that a new route cannot skip authentication
5. As an operator, I want namespace delete to remove members, collaborators and custom roles atomically, so that no orphans remain
6. As an operator, I want the last-owner invariant to hold on every path, so that a namespace is never left ownerless
7. As a maintainer, I want to build the app in a test without starting the server, so that route tests are fast and isolated
8. As an operator, I want boot, schedules and locks in one boot adapter, so that startup order is explicit
9. As a maintainer, I want the proxy to only forward and delegate lineage capture, so that lineage can be tested with a fake upstream
10. As a security reviewer, I want credential resolution to be a pure policy over a store, so that expiry and revocation rules are verifiable in memory
11. As a security reviewer, I want the CLI device flow not to persist the raw token longer than needed, so that a data-directory leak exposes less
12. As an operator, I want the poll throttle to be injectable and deterministic, so that tests never sleep
13. As a maintainer, I want the OIDC provider behind an interface with a fake, so that login tests need no module resets
14. As a maintainer, I want Keycloak calls behind a Directory adapter, so that directory policy is testable without HTTP
15. As a maintainer, I want one JSONL reader with defined corruption handling, so that audit, lineage, sessions and jobs behave alike
16. As an operator, I want read-modify-write on documents to be transactional, so that concurrent requests cannot lose updates
17. As a maintainer, I want migrations to run once at an explicit point, so that reads never write
18. As an operator, I want offboarding to define what happens if a step fails, so that partial offboarding is visible and retryable
19. As a maintainer, I want job rekeying to update state, aliases and logs together, so that a crash cannot orphan them
20. As a test author, I want shared principals, cookies and isolated setup, so that new tests are three lines of setup
21. As a test author, I want an injectable clock, so that expiry tests do not sleep or patch Date
22. As a web developer, I want permission names from one contract, so that a renamed permission fails a test, not a user
23. As a CLI user, I want role names validated against the server contract, so that typos fail locally
24. As a release manager, I want deny-path e2e in CI, so that fail-closed behaviour is verified end to end
25. As a new contributor, I want plan documents to point at modules that exist, so that I can navigate

## Implementation Decisions

- Behaviour-preserving: existing HTTP routes, status codes, denial reasons and audit actions stay the same unless a story says otherwise (items 2, 11 and 17 change internals only; error JSON shape stays per route family, shaped by one adapter).
- Test support is a non-test module that existing tests may adopt incrementally; heaviest offenders migrate first.
- A Clock interface is injected into credential, session and device-flow modules; default is system time.
- The authz repository is the only module that touches authz documents; stores and visibility become operations over it. Raw readers and writers are no longer exported.
- Namespace create and delete are single repository operations; delete enforces cascade over members, collaborators, roles; deleting a namespace is allowed only by callers already authorized.
- The Decision interface is `{allow, status, reason}`; instance actions, namespace management, session administration, access requests and service principal management resolve through action tables. Existing named functions stay as thin wrappers for compatibility.
- Route guard gains JSON-body parsing with required-field validation, shaped error responses and optional audit metadata; metadata, jobs, sessions, favorites and service-principal routes adopt it. Proxy-compatible error JSON remains an explicit adapter used by the proxy and the `/api` unauthorized path.
- `createApp(deps)` returns the Hono app and registers no timers; boot adapter owns identity migration, directory sync and expiry schedules, data-directory lock, workers, recovery and `serve()`. Readiness is exposed through an explicit interface.
- Proxy lineage capture exposes `before(request)` and `after(response)`; audit emission stays in the proxy and its effects module, keyed by the audit event id passed to capture.
- Credential store interface (list, find by hash, save, touch) with file and memory adapters; resolution returns a Principal or null; authentication observers are passed at composition, replacing the module-global hook list.
- Device authorization is a small state machine (pending, approved, consumed, expired) over a repository with an injectable clock; the raw token is handed over once and cleared on consumption.
- OIDC provider interface exposes begin login, complete login (claims), and logout URL; cache and key-set ownership are per provider instance. Directory interface exposes search, status and group lookup; the Keycloak adapter owns HTTP and token cache.
- JSONL log interface (append, read all, rewrite) and document store interface (read, transaction, migration owner) sit over the existing persistence seam; file and memory adapters both ship; audit, lineage, sessions, jobs, metadata and notifications adopt them where feasible. File-bound checkout, lock and runner modules stay file-bound.
- Lifecycle modules: offboarding, job rekey and namespace delete return a structured result listing completed and failed steps.
- Contract module lives in a shared location importable by auth, web and CLI; web validates `/auth/me/authz` at its adapter; CLI validates role and permission names.
- Deny-path e2e covers CSRF, idle expiry, revoked credential, and proxy ordering; CI runs them; stale plan pointers are fixed.

## Testing Decisions

- Good tests assert external behaviour through the module's interface (decisions, HTTP responses, returned principals), not storage layout or private helpers; expected values come from literals or the spec.
- Seams under test: authz Decision interface (matrix tests); authz repository interface (memory backend); `createApp` HTTP interface (`app.request`); credential store and resolution interface; device authorization interface with a fake clock; OIDC provider and Directory interfaces with fake adapters; JSONL and document store interfaces with file and memory adapters; proxy with `setUpstreamFetch`; lifecycle result interfaces; contract validation at web and CLI adapters.
- Prior art: requestInterpretation.test.ts, repoAction.test.ts, instanceAction.test.ts, proxyOrdering.test.ts, proxyEffects.test.ts, tokensMemory.test.ts, jsonStore.test.ts, routeGuard.test.ts, authenticate.test.ts.
- One small contract suite per file adapter keeps disk semantics covered; feature tests use the memory backend.
- Work test-first in vertical slices (red then green); full auth suite and typecheck must pass after each candidate.

## Out of Scope

- New product features or new permissions.
- Replacing JSON files with a database.
- Multi-replica support for leases and the data-directory lock.
- Rate limiting and a readiness feature beyond exposing existing state.
- Changing ADR 0001 identity trust or ADR 0002 default-deny.
- Committing or pushing; the user will decide.

## Further Notes

- Order: 1, 2, 3, then 4, 5, 6; 7, 8, 9 are independent adapter work; 10 follows 2 and 9; 11 and 12 are independent.
- Counts in this spec come from scanner greps and were not independently re-verified.
- QUERY /versions as Read remains an unverified assumption about oxen.
