# 18: Group Overage Handling (U17)

**What to build:** When the IdP returns a group overage indicator (user has too many groups to fit in claims), fetch groups via directory API (Microsoft Graph for Entra, equivalent for other IdPs) instead of failing login.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Detect group overage indicator in IdP claims (Entra: `_claim_names` with `groups` entry)
- [ ] Microsoft Graph API client for group fetch (GET /users/{id}/memberOf)
- [ ] Generic directory API interface (extensible to other IdPs: Okta, Auth0, etc.)
- [ ] Fetch groups on overage, store in session (same as direct claims)
- [ ] Fail login explicitly only if directory fetch also fails (network error, API unavailable)
- [ ] Per-IdP overage handling documented in deployment guide (Entra: Graph API, Okta: pagination)
- [ ] Tests for overage detection, Graph API fetch success, Graph API fetch failure, non-Entra IdPs

## Context

Round 8 decision U17 implements the "real fix" for group overage (line 367-375 in spec). Some IdPs (Entra) omit the group claim when a user has too many groups and send an overage pointer instead. The spec previously recommended failing login explicitly, but U17 moves to fetching groups via directory API.

This prevents blocking login for users in many groups (common in large organizations).
