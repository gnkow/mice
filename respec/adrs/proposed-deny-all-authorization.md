---
status: proposed
amends: 0002
---

# Authorization denies every unclassified route and is proven by contract tests

## Context

ADR 0002 denies unclassified GET/HEAD paths and makes unknown mutating routes require repo Admin. The interview (02 Q2, Q3, Q5, 00 Q16) tightens this: an "Admin-only" fallback still lets a new oxen route be used by an Admin before anyone has reviewed it, and nothing proves the path table matches the pinned oxen-server.

## Decision

- Every route not in the path table is denied for every method and every role, including repo Admin and instance admin. Classification is the only way to make a route reachable.
- The oxen-server is pinned by image digest. A contract test enumerates its routes and fails when one is not classified (or a classified one disappeared). A parity test does the same for BFF routes.
- Grants, favorites and scopes are keyed by stable repository id. A recreated name gets a new id; the old name returns 404/410 for a period.
- Re-authorization runs at each upload chunk and at publish, cached within a stated staleness bound.
- The rest of ADR 0002 (canonical paths, production refuses to start without enforced AuthZ, internal oxen network) stays.

## Consequences

- Upgrading oxen is a controlled change: the contract test fails until new routes are classified.
- Fewer surprises, but an unclassified route is a hard outage for that feature, not a degraded one.
- Existing "unknown mutating routes require Admin" wording in ADR 0002 is replaced when this is accepted.

## Alternatives rejected

- Admin-only fallback for unknown mutations (ADR 0002 today): admins can reach unreviewed routes.
- Allow unknown routes with a warning log: detection after the fact is not authorization.
- Sidecar between BFF and oxen: still deferred, as in ADR 0002.
