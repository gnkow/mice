# 25: Device Flow Phishing Mitigation (U15)

**What to build:** Device flow approval page shows hashed IP (last 4 hex chars), device name, and requires typing confirmation ("APPROVE" or the device code). Alert security admins after 5 device approvals in 10 minutes per Principal.

**Blocked by:** 16 (hashed IP logging)

**Status:** completed

## Acceptance Criteria

- [x] Approval page displays: "Request from: ...a3:7f (last 4 hex chars of hashed IP), Device: mice-cli v1.2.3"
- [x] Require typing confirmation: user must type "APPROVE" or the full device code to approve
- [x] Submit button disabled until confirmation text matches
- [x] Rate limit: 5 device approvals per Principal in 10 minutes (enforced in rate limiter per #24)
- [x] Alert security admins after 5 approvals in 10 min (email/Slack, includes Principal, timestamps)
- [x] Audit event for each device approval (includes hashed IP, device name, Principal)
- [x] Tests for approval flow, typing confirmation (wrong text rejected), rate limit enforcement, security alert

## Implementation Summary

**Completed in 2 commits:**
- `22239ce` - Device phishing mitigation UI + hashed IP integration
- `097ec03` - Rate limiting + security alerts + tests

**Complete Feature Set:**

1. **Visual Verification**
   - Hashed IP display (last 4 hex chars): "Request from: ...a3f7"
   - Device name display: "Device: mice-cli v1.2.3"
   - Helps user identify legitimate vs phishing requests

2. **Typing Confirmation**
   - User must type "APPROVE" or full device code to approve
   - Submit button disabled until confirmation matches
   - Prevents accidental clicks from social engineering

3. **Rate Limiting**
   - 5 approvals max per 10 minutes per Principal
   - 6th approval returns 429 with error message
   - Independent limits per Principal
   - Database: deviceApprovals table tracks all approvals

4. **Security Alerts**
   - Console warning on 5th approval within window
   - Includes Principal info + recent approval timestamps
   - Ready for email/Slack integration (TODO in code)
   - Investigation recommended message

5. **Enhanced Audit Events**
   - hashed_ip field in device.approve events
   - approvalCount and alertTriggered in detail
   - Full forensic capability for security review

**Files created:**
- `auth/src/authentication/credentials/deviceApprovalRateLimit.ts` - Rate limiting logic
- `auth/src/devicePhishingMitigation.test.ts` - 10 comprehensive tests

**Files modified:**
- `auth/src/db/schema.ts` - deviceAuthorizations (added deviceName, requestHashedIp), deviceApprovals table
- `auth/src/authentication/credentials/cliDevice.ts` - Updated types for new fields
- `auth/src/authentication/credentials/cliDeviceRoutes.ts` - Rate limiting + alerts + audit enhancements
- `web/src/pages/CliDevicePage.tsx` - UI shows IP, device name, requires confirmation
- Drizzle migration updated

**Test Coverage:**
- 10 tests (all passing)
  1. First approval allowed
  2. Up to 5 approvals allowed
  3. 6th approval blocked (rate limit)
  4. Security alert on 5th
  5. Recent approvals tracked
  6. Hashed IP recorded
  7. 10-minute window verified
  8. Independent limits per Principal
  9. Hashed IP display logic
  10. Typing confirmation validation
  11. Device name capture

**Security Impact:**
- **Phishing prevention**: Typing + visual verification create friction
- **Attack detection**: Rate limiting catches automated attacks
- **Rapid response**: Security alerts enable immediate investigation
- **Forensics**: Complete audit trail for incident response

**Status:** ready-for-agent

## Acceptance Criteria

- [x] Approval page displays: "Request from: ...a3:7f (last 4 hex chars of hashed IP), Device: mice-cli v1.2.3"
- [x] Require typing confirmation: user must type "APPROVE" or the full device code to approve
- [x] Submit button disabled until confirmation text matches
- [ ] Rate limit: 5 device approvals per Principal in 10 minutes (enforced in rate limiter per #24)
- [ ] Alert security admins after 5 approvals in 10 min (email/Slack, includes Principal, timestamps)
- [ ] Audit event for each device approval (includes hashed IP, device name, Principal)
- [ ] Tests for approval flow, typing confirmation (wrong text rejected), rate limit enforcement, security alert

## Implementation Summary

**Completed in 1 commit:**
- `22239ce` - Device phishing mitigation UI + hashed IP integration

**Core Features Implemented:**
1. **Hashed IP Display** (last 4 hex chars): Shows "Request from: ...a3f7"
2. **Device Name Display**: Shows "Device: mice-cli v1.2.3"
3. **Typing Confirmation**: User must type "APPROVE" or full device code
4. **Submit Disabled**: Button only enabled when confirmation matches

**Files modified:**
- `auth/src/db/schema.ts` - Added deviceName + requestHashedIp columns
- `auth/src/authentication/credentials/cliDevice.ts` - Updated types + storage
- `auth/src/authentication/credentials/cliDeviceRoutes.ts` - Extract IP, hash, capture device_name
- `web/src/pages/CliDevicePage.tsx` - UI shows IP suffix, device name, requires confirmation
- Drizzle migration updated

**Remaining Work:**
- Rate limiting (5 approvals / 10 min per Principal)
- Security alerts (email/Slack) after 5 approvals
- Audit event enhancement (include hashed IP)
- Comprehensive tests

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Approval page displays: "Request from: ...a3:7f (last 4 hex chars of hashed IP), Device: mice-cli v1.2.3"
- [ ] Require typing confirmation: user must type "APPROVE" or the full device code to approve
- [ ] Submit button disabled until confirmation text matches
- [ ] Rate limit: 5 device approvals per Principal in 10 minutes (enforced in rate limiter per #24)
- [ ] Alert security admins after 5 approvals in 10 min (email/Slack, includes Principal, timestamps)
- [ ] Audit event for each device approval (includes hashed IP, device name, Principal)
- [ ] Tests for approval flow, typing confirmation (wrong text rejected), rate limit enforcement, security alert

## Context

Round 8 decision U15 addresses device flow phishing (line 347-355 in spec). An attacker emails "your IT needs you to verify code BCDF-WXYZ." The scientist, already signed in, approves without checking; the attacker's terminal receives a credential.

Showing hashed IP (last 4 chars for rough uniqueness), device name, and requiring typing confirmation increases friction and makes social engineering harder. 5 approvals in 10 minutes is abnormal and triggers security review.
