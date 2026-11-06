# 22: Namespace membership entity versions

**What to build:** Adding, changing role of, or removing a namespace member appends entity version history for that membership, and the namespace membership UI shows the historic view. Separate from Audit (who/why) and from ticket 21 (settings).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Notes

- One history timeline per membership subject (user or group) within the namespace, or an equivalent reconstructable membership timeline—document the chosen grain in Notes when implementing.
- Role changes and removals must not overwrite prior states.

## Acceptance

- [ ] Member add / role change / remove each append version history
- [ ] Prior membership states remain readable and unchanged
- [ ] Namespace UI shows membership history for the entity
- [ ] HTTP tests reconstruct membership state across a sequence of changes without reading the Audit trail
