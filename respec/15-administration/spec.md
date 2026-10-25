Status: ready-for-agent

# 15 — Administration console and in-app docs (PLAT-ADMIN)

## Problem Statement

Admins need one place to manage users, roles, announcements, group bootstrap rules and instance state, and users need in-app documentation.

## Solution

A settings-based admin console with an overview, announcements targeted to audiences, group-bootstrap rules seeded from environment and editable in the UI, and a docs page.

## User Stories

1. As an instance admin, I want an overview of instance state (strict mode, health, revocations), so that I know what is running.
2. As an instance admin, I want to publish announcements to a namespace or group, so that messages reach the right people.
3. As a user, I want to dismiss announcements and (strict mode) acknowledge them with a receipt.
4. As an admin, I want an optional "also notify" toggle for announcements.
5. As an admin, I want group-bootstrap rules seeded from env and editable in the UI with audit.
6. As an admin, I want to revoke a Principal's Sessions and PATs from the UI.
7. As an admin, I want to manage service principals.
8. As a user, I want a Docs page with Mice-authored content.
9. As a translator, I want strings in a message catalog, so that locales can be added.
10. As an auditor, I want every admin change audited.

## Implementation Decisions

- The admin overview stays under `/settings`.
- Announcements are audience-targeted only (no instance-wide-without-audience mode; "everyone" is an explicit audience).
- Bootstrap rules: env seeds, UI edits override, both audited.
- Read receipts server-side for strict mode.
- Docs content ownership and locales are open: spec assumes English only with message-catalog readiness.

## Testing Decisions

- HTTP tests for announcement targeting, rule editing, and audit; Playwright for the UI.
- Prior art: existing admin e2e.

## Out of Scope

Additional locales, a separate `/admin` route.

## Further Notes

Rule precedence between env seed and UI edits needs a documented tie-break.
