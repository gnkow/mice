# 01: Production startup gate for authorization

**What to build:** In production the BFF refuses to start unless authorization is enforced and safely configured, and enforcement cannot be switched off at runtime. Extends the existing production startup gate.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Production start fails with a clear message when enforcement is not on
- [x] Production start fails when no bootstrap admin is configured
- [x] Production start fails when dev mode or dev grant-all is set
- [x] Production start fails when the data directory is not writable
- [x] In production, neither the env override nor the store flag can disable enforcement
- [x] Non-production behaviour is unchanged
