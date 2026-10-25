# 03: Audit, checkpoint and key logs are append-only in storage

**What to build:** The database itself rejects any change or removal of audit, checkpoint and key rows. Verification still detects tampering performed outside the application.

**Blocked by:** 02-sqlite-adapter

**Status:** done

- [ ] UPDATE and DELETE on append-only logs fail at the storage level
- [ ] The application interface offers no rewrite for these logs
- [ ] A tamper performed by removing the protection is still caught by chain verification and blocks mutations until acknowledged
- [ ] The TC-AUDIT-GXP tamper test is adapted to the database
