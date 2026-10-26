# 07: Typed JSON store

**What to build:** A store module owns the version check, default value and read-modify-write for a JSON document, replacing the repeated read/validate/write code in the newer stores (revocation cut-offs, service principals, directory-sync state, notified-expiry state).

**Blocked by:** 01 (Offboarding module)

**Status:** done

- [x] The four newer stores use the store module
- [x] Corrupt or missing files fall back to the default in one place
- [x] Existing tests pass; one test covers the store module's interface

Speculative: only the file adapter exists today, so no in-memory adapter is added until something needs it.
