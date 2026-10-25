# 13: Documentation matches the new persistence

**What to build:** README, the operations plan, `.env.example`, `Makefile` help and the glossary describe PostgreSQL, immudb and Novu, the removal of backups for now, the live-database test workflow, and the note for compliance owners that the hash chain and signed checkpoints are gone.

**Blocked by:** 12

**Status:** done

- [ ] No doc mentions SQLite, `mice.db`, the memory adapter, backup targets or the hash chain as current
- [ ] The test workflow (containers up, unique ids) is documented
- [ ] A GxP note lists validation documents that reference the removed chain

## Outcome

README (persistence table, live-database test workflow, failure mode), `plans/16-operations.md` section 2.3, `.env.example`, Makefile help and a storage banner on the affected plans describe PostgreSQL, immudb and Novu. `plans/04-gxp-compliance.md` carries the validation-impact note for the removed hash chain and signed checkpoints. Backups are documented as not provided.
