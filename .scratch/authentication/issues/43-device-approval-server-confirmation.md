Status: ready-for-agent

# 43: Server-side device-approval confirmation

**Spec:** `.specs/01-authentication.md` (U15)

**Blocked by:** none

Split from issue 25. The approval page already requires the phrase. This issue is the API.

## What to build

`POST /auth/cli/device/approve` accepts the device only when the body includes a confirmation equal to `APPROVE` or the full user code. Any other value is 400 and does not approve the device.

## In code today

The route requires `user_code` and then calls `approveDevice`. It does not read a confirmation field. The approval page disables its button until the text matches, then posts `{ user_code }` only.

## Acceptance

- [ ] Approve with confirmation `APPROVE` succeeds for a pending code
- [ ] Approve with the exact user code succeeds
- [ ] Approve with any other confirmation returns 400 and leaves the device pending
- [ ] The approval page sends the confirmation the route checks
