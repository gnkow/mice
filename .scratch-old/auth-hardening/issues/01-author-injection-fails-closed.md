# 01: Author injection fails closed

**What to build:** A client can no longer carry its own commit author past the BFF: every non-GET request whose body cannot be classified as author-bearing (malformed JSON, unknown content types) is rejected with `400` and not proxied. Author-free write routes (e.g. binary uploads) stay working via an explicit allowlist. Rejections appear in the audit log. See ADR 0001.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Malformed JSON write returns `400`; the fake oxen upstream receives nothing
- [x] Unknown content type on an author-bearing route returns `400`
- [x] Allowlisted author-free routes still proxy unchanged
- [x] Valid JSON and multipart writes still get IdP author name/email injected
- [x] Rejection is audited
- [x] Unclassified new write routes are unproxyable by default (tracked in 09)
