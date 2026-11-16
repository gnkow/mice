# 26: Reason policy operation inventory

**What to build:** A closing check that every mutating operation is classified against the reason policy: either it requires category + free text, or it is an explicit create/exemption with rationale. Close gaps found by the inventory in this ticket; large new gaps become follow-on tickets listed in Notes.

**Blocked by:** 03, 04

**Status:** done

## Notes

- Spec rule: reasons (and change-control id once 04 lands) for updates/deletes of existing records, destructive actions, privileged settings, revocation; creates and new data are exempt.
- Current create exemptions include `namespace.create`, `repo.create`, `branch.create`, and `file.write` (overwrites still create-exempt until overwrite detection lands).
- Known mutating routes that may need a decision: meta write/delete, session revoke, lineage rebuild, CLI device approve, training mark, self token delete.
- Distinct from entity version history (tickets 21–25) and from the Audit trail itself.

## Acceptance

- [x] Inventory lists every mutating BFF and proxied dataset operation and whether a reason is required
- [x] Every required operation refuses without category + free text and accepts with them (HTTP coverage or linked existing tests)
- [x] Every exemption has a written rationale in Notes
- [x] Gaps fixed here have tests; larger gaps are filed as follow-on tickets and linked
- [x] Ticket 03 acceptance remains true after the inventory (no silent weakenings)

## Comments

- **Deep-api Deepen (2026-11-16):** Pure helpers `inventoryRequiredDatasetActions` / `inventoryCreateExemptActions` in `reasonPolicyInventory.ts`; parity with `reasonRequiredActions()` + `createExemptActions()`. Unit + HTTP gap coverage: `reasonPolicyInventory.test.ts`. Status done.
