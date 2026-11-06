# 26: Reason policy operation inventory

**What to build:** A closing check that every mutating operation is classified against the reason policy: either it requires category + free text, or it is an explicit create/exemption with rationale. Close gaps found by the inventory in this ticket; large new gaps become follow-on tickets listed in Notes.

**Blocked by:** 03, 04

**Status:** ready-for-agent

## Notes

- Spec rule: reasons (and change-control id once 04 lands) for updates/deletes of existing records, destructive actions, privileged settings, revocation; creates and new data are exempt.
- Current create exemptions include `namespace.create`, `repo.create`, `branch.create`, and `file.write` (overwrites still create-exempt until overwrite detection lands).
- Known mutating routes that may need a decision: meta write/delete, session revoke, lineage rebuild, CLI device approve, training mark, self token delete.
- Distinct from entity version history (tickets 21–25) and from the Audit trail itself.

## Acceptance

- [ ] Inventory lists every mutating BFF and proxied dataset operation and whether a reason is required
- [ ] Every required operation refuses without category + free text and accepts with them (HTTP coverage or linked existing tests)
- [ ] Every exemption has a written rationale in Notes
- [ ] Gaps fixed here have tests; larger gaps are filed as follow-on tickets and linked
- [ ] Ticket 03 acceptance remains true after the inventory (no silent weakenings)
