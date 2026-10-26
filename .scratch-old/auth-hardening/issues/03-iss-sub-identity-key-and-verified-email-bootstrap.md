# 03: `iss`+`sub` identity key and verified-email bootstrap

**What to build:** Every Principal is identified by IdP `iss`+`sub` across memberships, group bindings, bootstrap lists and audit actors. Bootstrap admin / group bootstrap match `iss`+`sub`, or an email only when `email_verified` is true; the `<sub>@users.local` fallback never matches. Existing stores migrate once, idempotently, without losing access. See ADR 0001.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Two identities with the same `sub` under different `iss` are distinct Principals
- [x] Unverified email matching a bootstrap entry grants nothing
- [x] `@users.local` fallback never matches bootstrap
- [x] Verified email still bootstraps as before
- [x] Migration rewrites existing stores to `iss`+`sub`; running it twice changes nothing; previously granted access is preserved
- [x] Audit actors carry `iss`+`sub`
