Status: done

# 43: Server-side device-approval confirmation

**Spec:** `.specs/01-authentication.md` (U15)

**Blocked by:** none

Split from issue 25. The approval page already requires the phrase. This issue is the API.

## What to build

`POST /auth/cli/device/approve` accepts the device only when the body includes a confirmation equal to `APPROVE` or the full user code. Any other value is 400 and does not approve the device.

## In code today

`POST /auth/cli/device/approve` approves a pending device only when `confirmation` is `APPROVE` or the user code, ignoring case and surrounding space. Any other value is 400 and the device stays pending. The approval page posts the text the person typed.

## Acceptance

- [x] Approve with confirmation `APPROVE` succeeds for a pending code
- [x] Approve with the exact user code succeeds
- [x] Approve with any other confirmation returns 400 and leaves the device pending
- [x] The approval page sends the confirmation the route checks

## Comments

- **Audit:** holds — approve succeeds for `APPROVE` or user code; other confirmation → 400, device stays pending.
- **Deepen (auto-pick Top):** `normalizeDeviceApprovalText` + `decideDeviceApprovalConfirmation` own blank `user_code` and APPROVE/user-code matrix (returns `{ ok, userCode }` or 400); approve route is a one-call adapter. No UI; page confirmation stays issue 25.
- **Files:** `deviceApprovalConfirmation.ts`, `cliDeviceRoutes.ts` (wire-up only).
- **Tests:** `deviceApprovalConfirmation.test.ts` (unit + route integration).
- **Seams:** `decideDeviceApprovalConfirmation` (module); `POST /auth/cli/device/approve` (package).
