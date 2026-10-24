# 09: Directory-sync revocation

**What to build:** A scheduled job (interval configurable, default 15 minutes) and an admin-triggered run compare the IdP directory with known Principals and set the full cut-off (Sessions and PATs) for those disabled or removed. If the directory is unreachable, nobody is revoked (fail open) and the failure is recorded as an audit event. Each revocation is audited with source `directory-sync`.

**Blocked by:** 02 (Two-cut-off revocation)

**Status:** ready-for-agent

- [ ] A disabled or removed Principal's Sessions and PATs are rejected after a run
- [ ] An enabled Principal is untouched
- [ ] A directory outage revokes nobody and records an audit event
- [ ] An instance admin can trigger a run on demand; non-admins cannot
- [ ] The interval is configurable with a 15-minute default
- [ ] Tested with a stub directory client and a fake clock
