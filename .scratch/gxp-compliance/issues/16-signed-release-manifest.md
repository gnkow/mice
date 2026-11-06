# 16: Signed release manifest

**What to build:** Each release carries a signed manifest (versions and digests of IdP configuration, search index, custom verifiers) verified at start. A mismatch is audited and shown in the admin overview.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Release ships a signed manifest of IdP configuration, search index and custom verifiers
- [ ] Manifest is verified at start
- [ ] Mismatch is audited and visible in the admin overview
