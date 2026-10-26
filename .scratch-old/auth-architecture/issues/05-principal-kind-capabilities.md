# 05: Principal kind capabilities

**What to build:** A Principal answers what it can do (be an instance admin, have favorites, have Sessions, be active) by kind (human or service), so no caller compares issuer strings. Adding a capability happens in one module.

**Blocked by:** 03 (Migrate topic route files)

**Status:** done

- [x] Callers ask the capability, not the issuer string
- [x] The reserved issuer constant is used only by the kind module and startup validation (hasSession dropped: no caller needs it)
- [x] A table-driven test covers each capability for each kind
