# 51: Fixed session lifetime startup gate

**What to build:** Idle 15 minutes and absolute 8 hours are mandatory ceilings. The instance refuses to start with looser values.

**Spec:** `.specs/01-authentication.md`, `.specs/04-gxp-compliance.md` (Q19)

**Blocked by:** None

**Status:** done

## In code today

Defaults are 15 min / 8 h (`env.ts`), but startup only rejects zero or negative idle (`startupGate.ts`). `auth/src/authentication/README.md` still says 30 minutes.

## Acceptance

- [x] Startup fails when idle > 900 s or absolute > 8 h
- [x] Tests cover each boundary
- [x] README states the real values

An unset `SESSION_TTL_SEC` uses the 8 h default and passes.
