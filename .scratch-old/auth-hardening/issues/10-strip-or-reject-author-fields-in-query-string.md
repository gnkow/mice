# 10: Reject author fields in the query string

**What to build:** Client-chosen author name/email can no longer reach oxen through the URL query on any write (including bodyless ones such as DELETE). The BFF either strips or rejects author-like query parameters, then author injection remains the only source of authorship.

**Blocked by:** 01 (author injection fails closed; done)

**Status:** ready-for-agent

- [x] Inventory which oxen write routes read author fields from the query string (upstream reads authors from form/JSON/merge bodies; no query-string reader found, so rejection is defensive and name-based)
- [x] Write requests carrying author-like query parameters are rejected with `400` (or the parameters stripped, whichever the inventory supports) and nothing forged reaches the fake upstream
- [x] Bodyless writes (DELETE) are covered
- [x] GET/HEAD are unaffected
- [x] Rejection audited

Note: plain `name` is deliberately not treated as an author parameter.
