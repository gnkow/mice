# 02: Request authentication module (expand)

**What to build:** Extend the existing request-authentication module so a route states a small policy (browser Session only, allow scoped PATs, instance admin) and receives the authenticated Principal or a ready 401/403 outcome. The old per-route helpers keep working beside it.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] One call resolves cookie then PAT, applies the policy, and returns the Principal with how it authenticated
- [x] Scoped-credential and service-principal restrictions are decided inside the module
- [x] Tests cover each policy through the interface only
- [x] No existing route changes behaviour

Part of the expand–contract sequence: 03 and 04 migrate callers, 04 contracts.
