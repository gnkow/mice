# 09: Scheduled verified backups with retention

**What to build:** The BFF can take a verified database backup on a schedule and keep only the newest N, using the same copy operation as the manual command.

**Blocked by:** 02-schema-versioned

**Status:** done

- [ ] Backup is verified by opening and checking it
- [ ] Old backups beyond the retention count are removed
- [ ] Schedule is off unless configured
- [ ] Manual command shares the implementation
