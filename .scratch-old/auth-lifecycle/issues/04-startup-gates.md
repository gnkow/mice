# 04: Startup gates (idle timeout in GxP-strict, https issuer)

**What to build:** Two additions to the startup gate. GxP-strict mode refuses to start when the idle timeout is off. Production refuses a non-`https` OIDC issuer. Each refusal names the offending setting. Non-strict and non-production startup is unchanged. The validated idle value stays owned by the GxP plan.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] GxP-strict with idle timeout 0 fails startup with a clear message
- [x] GxP-strict with a positive idle timeout starts
- [x] Production with an `http` issuer fails startup with a clear message; `https` starts
- [x] Non-strict, non-production startup behaves as before
- [x] Covered by startup-gate tests using injected env
