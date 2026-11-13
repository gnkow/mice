Status: done

# 25: Device-flow approval context and rate limit

**Spec:** `.specs/01-authentication.md` (U15, display and rate-limit half)

The approve API rejecting a missing confirmation phrase is issue 43.

## Outcome

The device approval page shows the last 4 hex characters of the request's hashed IP and the device name. The submit button stays disabled until the user types `APPROVE` or the full user code. The approve route allows 5 approvals per Principal per 10 minutes and returns 429 after that. The fifth approval in the window logs a security warning with the Principal and recent timestamps. The approval audit event includes the hashed IP, device name, and Principal.

## Acceptance

- [x] The approval page shows the hashed-IP suffix and the device name
- [x] The page submit control stays disabled until the confirmation text matches
- [x] A sixth approval within 10 minutes for the same Principal returns 429
- [x] The fifth approval logs a security warning with Principal and timestamps
- [x] The approval audit event includes hashed IP, device name, and Principal

## Code

- `web/src/pages/CliDevicePage.tsx`
- `auth/src/authentication/credentials/cliDeviceRoutes.ts`
- `auth/src/authentication/credentials/deviceApprovalRateLimit.ts`

## Comments

- **Audit:** holds — rate limit 5/10min → 429, fifth-approval security warning, confirmation gate, hashed-IP/device-name display covered by `devicePhishingMitigation.test.ts`, `deviceApprovalConfirmation.test.ts`, and CliDevicePage.
- **Deepen:** Collapsed check/record/recent/warning orchestration into `createDeviceApprovalRateLimit().begin()` → `commit()` (one small interface; security warning built behind the seam). CliDevicePage confirmation matching extracted to `isApprovalConfirmation` with real unit tests (replaced tautological inline checks).
- **Files:** `auth/src/authentication/credentials/deviceApprovalRateLimit.ts`, `cliDeviceRoutes.ts`, `auth/src/devicePhishingMitigation.test.ts`, `web/src/lib/cliDeviceApproval.ts`, `web/src/lib/cliDeviceApproval.test.ts`, `web/src/pages/CliDevicePage.tsx`.
