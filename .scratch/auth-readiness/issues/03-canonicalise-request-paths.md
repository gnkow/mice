# 03: Canonicalise request paths before authorising

**What to build:** The BFF canonicalises each proxied path once, rejects non-canonical forms with 400, and forwards exactly the canonical path it authorised.

**Blocked by:** 02 (single path table)

**Status:** done

- [x] Encoded slashes or backslashes, encoded or literal dot segments, and double slashes return 400
- [x] Case variants of known routes are not treated as a different, unclassified route that is allowed
- [x] The path sent upstream equals the path that was classified
- [x] Normal routes, including trailing slashes already handled today, keep working
- [x] Tests cover each rejected form and prove oxen is not called
