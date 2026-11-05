# UI — Auth & Authz polish

## Context

Authentication and authorization (including RBAC seams S32–S36) are functionally complete. This effort is a **UI breakpoint**: improve how those features look and feel without changing RBAC behavior or API contracts.

## Goal

Polish all auth-related surfaces using the **ui-ux-pro-max** skill for UX/a11y/form guidance, while **preserving** existing MICE CSS tokens and product look.

## Surfaces

- Login / SSO shell
- Pending access (request + submitted)
- Profile (role badge, permissions, request-additional)
- Settings (Access Requests review, Grant Access, users/permissions)
- CLI device approval
- Auth boot / gate chrome on those paths

## Constraints

- No backend or permission-catalog changes
- Keep unit and e2e RBAC contracts green
- Prefer CSS classes over inline styles
- Do not commit the ui-ux-pro-max skill into the repo (install globally)

## Tracker root

Issues live under `.sketch/issues/` (this folder), not `.scratch/`.
