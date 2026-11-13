Status: done

# 27: Principal re-enable after IdP disable

**Spec:** `.specs/01-authentication.md` (R1)

Previously filed as `05-principal-re-enable-logic.md`. The schema comment "Ticket 05" refers to this issue. Mice suspension is issue 28.

## Outcome

The first time a Principal is seen IdP-disabled, `principal_disabled_periods` records `disabled_at`. A return to enabled within 30 days restores access and audits `auth.reenable.automatic` with the duration and the grants that remained. A longer disable stays blocked with 403 until an instance admin confirms at `POST /auth/admin/re-enable`, which audits `auth.reenable.confirmed` and the confirming Principal. A Mice `suspended` flag blocks the automatic restore. Grants are left in place.

## Acceptance

- [x] The first detection of IdP-disabled records `disabled_at` for that Principal
- [x] A return to enabled within 30 days, with no Mice flag, restores access and writes an automatic restoration audit event
- [x] A return to enabled after more than 30 days leaves the Principal blocked and lists them for admin confirmation
- [x] Admin confirmation restores access, records the confirming Principal, and writes an audit event
- [x] A Mice suspension flag blocks automatic restoration

## Code

- `auth/src/authentication/access/reenable.ts`
- `auth/src/authentication/access/reenableRoutes.ts`
- `auth/src/authentication/session/requireAuth.ts`
- `auth/src/authentication/oidc/loginFlow.ts`
- `web/src/components/ReenableSection.tsx`

## Comments

- **Audit:** holds — first `disabled_at`, automatic restore within 30 days, admin confirm past window, and Mice-blocked automatic restore proven by `reenable.test.ts` at the re-enable / authenticate seams.
- **Deepen (auto-pick Top):** Introduced internal `decideRestoration` + shared open-period load/`closePeriod` in `reenable.ts`. Window / Mice / IdP eligibility live in one decision table; `considerReenable` and `confirmReenable` stay the public seams (no `requireAuth` / `loginFlow` edits). Tests use `regulatedMutationHeaders` for admin POSTs.
