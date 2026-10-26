Status: ready-for-agent

# 02 — Authorization (PLAT-AUTHO)

## Problem Statement

Every request to oxen-server and to Mice features must be allowed or denied by a clear role model, with default-deny, so that scientists see only what they should.

## Solution

The BFF classifies every route to an action, resolves the Principal's roles through namespace and repository membership, groups, instance permissions and custom roles, and denies anything unclassified (ADR 0002). Resources are keyed by stable repository id. Stage actions use a `stage` resource directly.

## User Stories

1. As a repository admin, I want to grant read, write, maintain or admin to users and groups, so that access is least-privilege.
2. As a namespace owner, I want namespace roles to flow to repositories, so that I manage access once.
3. As an instance admin, I want custom roles built from an action catalog, so that I model our organisation.
4. As an instance admin, I want delegated instance permissions, so that I can split admin duties.
5. As a security reviewer, I want unclassified routes denied, so that new oxen endpoints are never open by accident.
6. As a developer, I want a test that the path map and the role checks agree, so that they cannot drift.
7. As a user, I want a denied request to explain what permission is missing without leaking resource existence, so that I can ask for access.
8. As an auditor, I want every grant, revoke and role change audited, so that access history is reconstructable.
9. As a CLI user, I want my credential scopes to narrow, never widen, my live permissions.
10. As an instance admin, I want Jobs to run under BFF-internal tokens governed by the submitting user's permissions, so that automation is controlled without service principals.
11. As a developer, I want `stage.*` action names from day one, so that no legacy names or aliases exist.
12. As a user of a renamed repository, I want my access unchanged, so that renames are not a permissions event.
13. As an instance admin, I want to see why an access decision was made, so that I can debug.

## Implementation Decisions

- Default-deny; every unclassified route is denied, ADR 0002 is updated, and the parity test fails on any new route.
- Authorization references stable repository ids so rename and transfer do not orphan grants.
- Group membership is re-checked against the directory on use with a stated maximum staleness, plus an admin refresh action; revocation per Principal is the immediate path.
- Stage (Oxen workspace) actions use a `stage` resource with no aliases or migration.
- Chunked upload and import routes are explicitly classified at repo `write` and re-authorized at each chunk and at publish.
- Transfer needs source repo `admin` plus destination namespace Owner approval; collaborators are dropped by default.
- Mandatory expiry on outside and delegated grants and scheduled access-review campaigns are both included.
- State lives in PostgreSQL and is consistent across instances.

## Testing Decisions

- Black-box HTTP tests per role and action, including denied cases and unclassified routes.
- A parity test comparing the path map with the enforcement logic.
- Prior art: existing authz matrix tests.

## Out of Scope

Breakglass, and "internal" visibility.

## Further Notes

Transfer is a BFF metadata change with no oxen move (05 Q25, Q10); confirm that oxen paths do not embed the namespace.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Roles and guards
- Self-merge is forbidden everywhere with no override, so every repository needs at least two eligible mergers (Q1).
- Last-owner and last-admin guards use database constraints and locking, with a two-instance test (Q7). Removing the last Owner is blocked; an offboarded Owner alerts instance admins and requires a new Owner within N days (Q23).
- A namespace Owner gets Admin, but collaborator grants on restricted or GxP repositories need data-owner approval or notification (Q10).
- Members create repositories only where the Owner allows; the default is private to the creator and namespace admins (Q18).
- Mandatory expiry on outside and delegated grants, and scheduled access-review campaigns, both now (Q11).
- Only main is protected globally (Q17).
- Training is not implemented: out of scope, no self-attestation; revisit (Q25).

Classification and identity
- Deny every unclassified route; update ADR 0002 (Q2). A contract test enumerates the routes of the pinned oxen, with an exact server pin (Q3).
- Repository ids are assigned at creation in one transaction; a reconciliation report covers pre-existing repositories (Q4).
- Grants, favorites and scopes are keyed by repository id only; a recreated name gets a new id and the old name returns 404/410 for a period (Q5).
- Transfer needs source repo admin plus destination namespace Owner approval; collaborators are dropped by default (Q6).
- Credentials are scoped to repository id plus action and intersected with live permissions; PATs do not exist (Q19). Service principals are removed (Q21).
- Groups are bound on IdP group id plus issuer; a disappeared group warns and missing claims fail loudly (Q13). Directory groups are re-checked on use within a staleness bound, with an admin refresh (Q12).
- Chunked uploads are re-authorized at each chunk and at publish, cached within the staleness bound (Q14).

Visibility, elevation and audit
- Instance admin has no data access by default; elevation needs a reason, a time-box, a second approver in strict, and an audited Intent; read and write are distinguished (Q8).
- A read-only, time-boxed, audited Auditor/Inspector role is added (Q16).
- Bypass mutations and sensitive reads are audited individually; routine listing reads become one summary event per page or session (Q9).
- Denials return 404 for no-read and 403 for visible-but-forbidden; reason codes appear only in audit and Administration; timing is consistent (Q22).
- All listings, search, counts, activity and favorites are filtered server-side, with a leakage test per list endpoint (Q15).
- Events carry namespaces and repo ids; a namespace view shows only fully visible events; cross-namespace needs instance auditors (Q28).
- There is no hard delete; archive only, and audit and lineage are retained (Q24).
- Testing uses a generated route-by-role-by-state matrix at the BFF boundary plus targeted tests (Q26).
- Q20 and Q27 are inherited (new project; absolute fail-closed).

## Conflicts and open risks

- Q17: only main is protected; force-push and deletion of other released branches stay unprotected. RISK, accepted as chosen (05 Q12 mitigates with revert-only).
- Q12 (staleness-bounded directory re-check) versus 15 Q21 (no cache, per-request revocation read) and 01 Q4 (about 2 s cache): CONFLICT on caching; a single staleness figure must be set across 01, 02 and 15.
- Q9 (routine listing reads summarized) versus 00 Q4 (all reads audited): reconciled only if the summary event counts as the audit; confirm in 03.
- Q1: forbidding self-merge needs two eligible mergers per repository; small repositories cannot merge until a second maintainer exists, and 04 Q18 says escalation is unconfirmed.
- Q6 and 05 Q10: transfer is a BFF metadata change with no oxen move; PENDING confirmation that oxen paths do not embed the namespace.
- Q8 (second approver in strict) versus 15 Q6 (second approver for elevation, design to split later): consistent; strict is now always on, so the second approver is always required.
- Q4: pre-existing repositories need a reconciliation report; 16 Q24 says the pilot is wiped, so this may be moot.
- Q21 and Q19: PATs and service principals are gone; 07, 09 and 12-14 still reference them in places.
- Q25: training gating is deferred; no self-attestation is built.
- Q2 and 05 Q17, 11 Q25: unclassified routes are denied; lineage classification failure creates a gap op rather than a bypass.
