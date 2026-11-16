# 22: Namespace membership entity versions

**What to build:** Adding, changing role of, or removing a namespace member appends entity version history for that membership, and the namespace membership UI shows the historic view. Separate from Audit (who/why) and from ticket 21 (settings).

**Blocked by:** None (can start immediately)

**Status:** done (API acceptance; UI historic view out of deep-api)

## Notes

- Grain: one membership-set snapshot per namespace (all user/group seats) after each mutation.
- Role changes and removals must not overwrite prior states.
- Shared close→open seam: `appendVersionInterval` → `recordMembershipVersion`.

## Acceptance

- [x] Member add / role change / remove each append version history
- [x] Prior membership states remain readable and unchanged
- [ ] Namespace UI shows membership history for the entity _(UI out of deep-api)_
- [x] HTTP tests reconstruct membership state across a sequence of changes without reading the Audit trail

## Comments

- **Deep-api Deepen (2026-11-16):** Top — `appendVersionInterval` wired into `recordMembershipVersion`. HTTP: `namespaceMembershipVersions.test.ts`. Status done (API); UI gap noted.
