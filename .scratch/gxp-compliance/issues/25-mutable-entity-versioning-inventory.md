# 25: Mutable-entity versioning inventory

**What to build:** An inventory of every mutable BFF domain entity, confirming each either has append-only entity version history with an historic view, or an explicit exemption with rationale recorded in the ticket Notes. Close remaining gaps found by the inventory (small leftover entities) in this ticket; large new gaps become follow-on tickets listed in Notes.

**Blocked by:** 21, 22, 23, 24

**Status:** ready-for-agent

## Notes

- Already expected to count as versioned before this ticket: oxen repository data, principal names, RBAC roles/permissions (+ permission snapshots), metadata revisions, access-flag history, plus tickets 21–24.
- Audit events, oxen History page, and entity version history must not be conflated in the inventory.
- Exemptions need a written rationale (e.g. pure derived cache, ephemeral lock).

## Acceptance

- [ ] Inventory lists every mutable BFF domain entity and its versioning status
- [ ] Every non-exempt entity has reconstructable entity version history (not audit-only)
- [ ] Every exemption has a rationale in Notes
- [ ] Any gap fixed in this ticket has HTTP coverage that history is entity-sourced
- [ ] Spec story 15 can be marked satisfied once this ticket is done (or remaining follow-ons are filed and linked here)
