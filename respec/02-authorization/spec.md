Status: ready-for-agent

# 02 — Authorization (PLAT-AUTHO)

## Problem Statement

Every request to oxen-server and to Mice features must be allowed or denied by a clear role model, with default-deny, so that scientists see only what they should.

## Solution

The BFF classifies every route to an action, resolves the Principal's roles through namespace and repository membership, groups, instance permissions and custom roles, and denies anything unclassified (ADR 0002). Resources are keyed by stable repository id. Stage actions migrate to a `stage` resource name.

## User Stories

1. As a repository admin, I want to grant read, write, maintain or admin to users and groups, so that access is least-privilege.
2. As a namespace owner, I want namespace roles to flow to repositories, so that I manage access once.
3. As an instance admin, I want custom roles built from an action catalog, so that I model our organisation.
4. As an instance admin, I want delegated instance permissions, so that I can split admin duties.
5. As a security reviewer, I want unclassified routes denied, so that new oxen endpoints are never open by accident.
6. As a developer, I want a test that the path map and the role checks agree, so that they cannot drift.
7. As a user, I want a denied request to explain what permission is missing without leaking resource existence, so that I can ask for access.
8. As an auditor, I want every grant, revoke and role change audited, so that access history is reconstructable.
9. As a PAT holder, I want my token scopes to narrow, never widen, my roles.
10. As an instance admin, I want a service principal's access governed like a user's, so that automation is controlled.
11. As an existing custom-role owner, I want `workspace.*` roles migrated to `stage.*` with aliases, so that nothing breaks during the window.
12. As a user of a renamed repository, I want my access unchanged, so that renames are not a permissions event.
13. As an instance admin, I want to see why an access decision was made, so that I can debug.

## Implementation Decisions

- Default-deny; unclassified mutations default to `admin`.
- Authorization references stable repository ids so rename and transfer do not orphan grants.
- Group claims come from the Session or PAT snapshot; revocation per Principal is the immediate path.
- Stage (Oxen workspace) actions migrate to a `stage` resource with a compatibility alias window and a custom-role migration.
- Chunked upload and import routes are explicitly classified at repo `write` (fixes the current `admin` fallthrough).
- Transfer destination checks: require repo `admin` and destination namespace `write`, to be confirmed.
- Scheduled access review campaigns and mandatory breakglass expiry are not included.
- State lives in PostgreSQL and is consistent across instances.

## Testing Decisions

- Black-box HTTP tests per role and action, including denied cases and unclassified routes.
- A parity test comparing the path map with the enforcement logic.
- Prior art: existing authz matrix tests.

## Out of Scope

Access-review campaigns, breakglass expiry, live directory re-checks, "internal" visibility.

## Further Notes

Transfer destination rule is the only unconfirmed item; confirm in code before implementing.
