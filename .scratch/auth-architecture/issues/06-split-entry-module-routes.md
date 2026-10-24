# 06: Split the entry module's routes by topic

**What to build:** Token, instance-admin and revocation routes move out of the entry module into topic route modules that take their dependencies, as service principal routes already do. The entry module only wires.

**Blocked by:** 04 (Migrate index and contract)

**Status:** ready-for-agent

- [ ] Tokens, instance admin and revocation routes live in their own modules
- [ ] The entry module shrinks accordingly; route paths and responses are unchanged
- [ ] Existing tests pass; each moved module has a route test that needs no whole-app setup
