# 53: Signature identity display and PAT leftovers

**What to build:** Wire the existing name-change history into signature views so a signature shows the printed name snapshot and an optional "now known as" note. Remove leftover personal-access-token terminology.

**Spec:** `.specs/01-authentication.md`, `.specs/04-gxp-compliance.md` (Q9)

**Blocked by:** gxp-compliance/03

**Status:** ready-for-agent

## In code today

`session/nameChangeHistory.ts` exists; display integration is unclear. `credentials/patScopes.ts` still carries `PatScope` naming although PATs are removed (ticket 48).

## Acceptance

- [ ] Signature views show the snapshot (name, `iss`, `sub`, time) and the current-name note when it differs
- [ ] A deactivated account's past signatures stay valid and attributable
- [ ] `PatScope` and `parsePatScopes` are renamed to CLI credential scopes with no behaviour change
