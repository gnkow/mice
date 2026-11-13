/**
 * Server-side device-approval confirmation (issue 43).
 * APPROVE or the full user code — case and surrounding space ignored.
 */

export const DEVICE_APPROVAL_CONFIRM_PHRASE = 'APPROVE'
export const DEVICE_APPROVAL_CONFIRM_ERROR = 'Type APPROVE or the full user code'

/** True when confirmation is APPROVE or the full user code (case-insensitive). */
export function isDeviceApprovalConfirmation(
  confirmation: unknown,
  userCode: string,
): boolean {
  if (typeof confirmation !== 'string') return false
  const normalized = confirmation.trim().toUpperCase()
  if (!normalized) return false
  const code = userCode.trim().toUpperCase()
  if (!code) return false
  return normalized === DEVICE_APPROVAL_CONFIRM_PHRASE || normalized === code
}

export type DeviceApprovalConfirmation =
  | { ok: true }
  | { ok: false; status: 400; error: string }

/**
 * Deep seam for the approve route: allow, or 400 with the typed-confirmation message.
 * Callers need not re-encode the APPROVE / user-code matrix.
 */
export function decideDeviceApprovalConfirmation(
  confirmation: unknown,
  userCode: string,
): DeviceApprovalConfirmation {
  if (isDeviceApprovalConfirmation(confirmation, userCode)) return { ok: true }
  return { ok: false, status: 400, error: DEVICE_APPROVAL_CONFIRM_ERROR }
}
