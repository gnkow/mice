# 01: Offboarding module

**What to build:** One offboarding module owns "end this Principal's access": the cut-off scope (Sessions only, or Sessions and PATs), the suspension of service principals the Principal owns, and the audit event with its cause. Admin revocation, directory sync, self-service sign out and back-channel logout all go through it, so the consequences no longer depend on which caller ran.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One interface takes the Principal, scope, cause and actor, and applies cut-off, suspension and audit
- [ ] All four callers use it; none calls the cut-off functions or the suspension helper directly
- [ ] Revocation storage no longer depends on audit or service principals
- [ ] Existing behaviour and tests are unchanged; new tests cross only the new interface
