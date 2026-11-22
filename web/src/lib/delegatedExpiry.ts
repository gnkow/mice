const DELEGATED_EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000

/** Mirror auth `decideDelegatedInstanceExpiry` refusal copy for the Settings form. */
export const DELEGATED_EXPIRY_REQUIRED =
  'Expiry date is required for delegated permissions'
export const DELEGATED_EXPIRY_MUST_BE_FUTURE = 'Expiry must be a future date and time'

/**
 * Client-side decide for the delegated-permissions form. Empty permissions = clear grant.
 */
export function decideDelegatedGrantForm(input: {
  permissions: readonly string[]
  expiresAtMs: number | null | undefined
  now?: number
}): string | null {
  if (input.permissions.length === 0) return null
  if (input.expiresAtMs == null || !Number.isFinite(input.expiresAtMs)) {
    return DELEGATED_EXPIRY_REQUIRED
  }
  if (input.expiresAtMs <= (input.now ?? Date.now())) return DELEGATED_EXPIRY_MUST_BE_FUTURE
  return null
}

export function delegatedExpiryTone(
  expiresAt: number,
  now = Date.now(),
): 'expired' | 'soon' | 'ok' {
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return 'expired'
  if (expiresAt - now <= DELEGATED_EXPIRY_SOON_MS) return 'soon'
  return 'ok'
}

export function delegatedExpiryLabel(expiresAt: number, now = Date.now()): string {
  const tone = delegatedExpiryTone(expiresAt, now)
  if (tone === 'expired') return 'Expired'
  const days = Math.max(1, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))
  if (tone === 'soon') return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`
  return `Expires ${new Date(expiresAt).toLocaleString()}`
}
