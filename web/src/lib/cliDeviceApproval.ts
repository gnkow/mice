/** Device-approval confirmation: APPROVE or the full user code (case-insensitive). */
export function isApprovalConfirmation(
  input: string,
  userCode: string | undefined,
): boolean {
  const normalized = input.trim().toUpperCase()
  if (!normalized || !userCode) return false
  return normalized === 'APPROVE' || normalized === userCode.trim().toUpperCase()
}
