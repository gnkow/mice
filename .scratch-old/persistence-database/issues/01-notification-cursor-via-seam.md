# 01: Notification replay reads audit through the persistence seam

**What to build:** The notification worker replays new audit events using a row-sequence cursor obtained from the persistence seam, not a byte offset into a file. Existing notification state with a byte offset is upgraded without replaying or losing events.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] The seam's log interface can read rows after a sequence number and report the last sequence
- [ ] Replay delivers each audit event exactly once across restarts and never touches the file system directly
- [ ] A legacy byte-offset cursor is migrated to the equivalent sequence
- [ ] Swapping or truncating the audit storage no longer raises a SyntaxError; it fails with a clear error
