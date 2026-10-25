# 08: Disk documents follow the document rules

**What to build:** Leases, workspace state, base manifests and the changes cache use the same document interface (one corruption rule, atomic write) while staying real files beside their workspace.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Document store can target the disk
- [ ] No module reads or writes these JSON files by hand
- [ ] Existing workspace tests stay green
