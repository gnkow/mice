# 10: Database maintenance and health

**What to build:** A scheduled step checkpoints the WAL, optimizes and re-checks integrity; readiness reports schema version and WAL size.

**Blocked by:** None

**Status:** done

- [ ] Maintenance leaves data intact and shrinks the WAL
- [ ] A failed integrity check turns storage readiness red
- [ ] Schedule is testable with a fake clock
