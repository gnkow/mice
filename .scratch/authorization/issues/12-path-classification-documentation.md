# 12: Path Classification Documentation

**What to build:** The route classification table is committed and maintained. `docs/authorization-routes.md` documents all classified routes with their minimum roles/permissions. ADR 0002 updated to state "deny all unclassified routes" explicitly. The route table in `authzPathMap.ts` is the source of truth and is referenced from the spec. Developers can look up any route's classification requirements.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Commit `docs/authorization-routes.md` (currently uncommitted)
- [ ] Update ADR 0002 (`docs/adr/0002-bff-default-deny.md`) to state "deny all unclassified routes"
- [ ] Add comment in `authzPathMap.ts` pointing to documentation file
- [ ] Spec appendix references `docs/authorization-routes.md` for complete table
- [ ] Route table includes all current oxen routes with minimum role/permission
- [ ] Documentation shows route classification maintenance process
- [ ] Tests verify documentation matches `authzPathMap.ts` (parity test)
- [ ] Tests verify unclassified routes are denied (contract test)
