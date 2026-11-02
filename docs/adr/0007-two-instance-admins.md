---
status: accepted
---

# At least two instance admins remain

Mice does not issue a recovery token. Removing an instance admin is refused when it would leave fewer than two. Two admins can still appoint another, and only then can one of the earlier two be removed. Q67's one-hour, two-person recovery token is not built: the break-glass case it exists for is an instance with no admin left, and this floor keeps that case from being reached by deletion.

## Considered options

- A signed, single-use recovery token, valid for one hour, created by two admins and stored in Postgres (Q67). Presenting it would grant instance admin. The request already lives only in process memory, and validate returns 501.
- Refuse deletion that would leave fewer than two instance admins. The last-admin check already exists and stops at one.

## Consequences

- Issue 39 is the floor of two, not token persistence. The recovery-token routes and the settings Recovery section come out.
- An instance admin who can no longer sign in still occupies a row. The floor counts those rows. It does not appoint a replacement when the IdP disables someone.
