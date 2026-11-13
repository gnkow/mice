/**
 * Server-side device-approval confirmation (issue 43).
 * APPROVE or the full user code — case and surrounding space ignored.
 */

export const DEVICE_APPROVAL_CONFIRM_PHRASE = 'APPROVE'
export const DEVICE_APPROVAL_CONFIRM_ERROR = 'Type APPROVE or the full user code'
export const DEVICE_APPROVAL_USER_CODE_ERROR = 'user_code required'

/** Normalize confirmation / user-code text for case-insensitive compare. */
export function normalizeDeviceApprovalText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase()
}

/** True when confirmation is APPROVE or the full user code (case-insensitive). */
export function isDeviceApprovalConfirmation(
  confirmation: unknown,
  userCode: string,
): boolean {
  const normalized = normalizeDeviceApprovalText(confirmation)
  if (!normalized) return false
  const code = normalizeDeviceApprovalText(userCode)
  if (!code) return false
  return normalized === DEVICE_APPROVAL_CONFIRM_PHRASE || normalized === code
}

export type DeviceApprovalConfirmation =
  | { ok: true; userCode: string }
  | { ok: false; status: 400; error: string }

/**
 * Deep seam for the approve route: require a user code, then APPROVE / user-code matrix.
 * Callers need not re-encode blank-code or confirmation rules.
 */
export function decideDeviceApprovalConfirmation(
  confirmation: unknown,
  userCode: unknown,
): DeviceApprovalConfirmation {
  if (typeof userCode !== 'string' || !userCode.trim()) {
    return { ok: false, status: 400, error: DEVICE_APPROVAL_USER_CODE_ERROR }
  }
  if (isDeviceApprovalConfirmation(confirmation, userCode)) {
    return { ok: true, userCode }
  }
  return { ok: false, status: 400, error: DEVICE_APPROVAL_CONFIRM_ERROR }
}
