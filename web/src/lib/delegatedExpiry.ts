const DELEGATED_EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000

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
