# 24: Custom role entity versions

**What to build:** Creating, updating, or deleting a custom namespace or repository role appends entity version history, and the custom-roles UI shows the historic view. Separate from Audit.

**Blocked by:** None (can start immediately)

**Status:** done (API acceptance; UI historic view out of deep-api)

## Acceptance

- [x] Custom role create / update / delete each append version history (permissions and metadata as stored on the role)
- [x] Prior role definitions remain readable and unchanged
- [ ] Custom-roles UI shows chronological entity history _(UI out of deep-api)_
- [x] HTTP tests reconstruct a role definition across changes without reading the Audit trail

## Comments

- **Deep-api Deepen (2026-11-16):** Top — `appendVersionInterval` wired into `recordCustomRoleVersion` (`customRoles.ts`). Module/HTTP: `customRoleVersions.test.ts`. Status done (API); UI gap noted.
