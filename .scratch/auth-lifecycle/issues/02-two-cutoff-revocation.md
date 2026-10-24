# 02: Two-cut-off revocation

**What to build:** Credential revocation records two cut-offs per Principal: a sessions-only cut-off and a full cut-off (Sessions and PATs created at or before it). The credential-validity check consults the right one for each credential type. Admin "revoke sessions" keeps its current behaviour (full). Stored revocations from before this change are read as full cut-offs.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A sessions-only cut-off rejects older Sessions and leaves PATs valid
- [ ] A full cut-off rejects older Sessions and older PATs (current admin behaviour)
- [ ] Existing stored revocation data is still honoured as a full cut-off after upgrade
- [ ] Cut-offs are monotonic: a later call never lowers an earlier one
- [ ] Verified through the HTTP wiring seam with a fake clock
