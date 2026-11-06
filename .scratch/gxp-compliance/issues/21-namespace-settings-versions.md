# 21: Namespace settings entity versions

**What to build:** Every change to namespace settings appends an entity version (successive states), and the namespace settings UI shows that historic view. This is not the Audit trail: audit still records who/why; this ticket stores what the settings were after each change.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Notes

- Distinct from audit events and from oxen commit history.
- Creates open the first version; updates close the prior version and open the next; deletes close without a successor (or record a tombstone version—pick one and keep it consistent with later tickets).
- Prior versions are never edited or deleted.

## Acceptance

- [ ] Updating namespace settings appends a new version with the post-change state
- [ ] Prior versions remain readable and unchanged
- [ ] Namespace settings UI shows chronological entity history (state at each version)
- [ ] Creating a namespace records an initial version
- [ ] HTTP tests: after N updates, history has N+1 reconstructable states; audit events alone are not used as the history source
