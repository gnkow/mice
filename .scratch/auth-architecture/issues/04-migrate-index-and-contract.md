# 04: Migrate the entry module's routes and remove the old helpers (contract)

**What to build:** The routes that still live in the entry module authenticate through the shared module, and the old session/bearer helpers are deleted. After this, no code outside the module resolves a PAT from a bearer header.

**Blocked by:** 03 (Migrate topic route files)

**Status:** done

- [x] No caller outside the module resolves a bearer PAT directly
- [x] `requireSession` and `requireBrowserSession` helpers are gone
- [x] All unit and e2e auth tests pass
