# 11: One backup path and a verified restore

**What to build:** make db-backup uses the verified backup module; make db-restore verifies a copy, keeps the current database aside and swaps.

**Blocked by:** None

**Status:** done

- [ ] Backup script verifies like the schedule
- [ ] Restore refuses a corrupt or newer-schema copy
- [ ] Restore keeps the replaced database
