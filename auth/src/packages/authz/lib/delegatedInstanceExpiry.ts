/** Refusal reasons for a non-empty delegated instance-permission grant. */
export const DELEGATED_EXPIRY_REQUIRED =
  'expiresAt is required for delegated instance permissions'
export const DELEGATED_EXPIRY_MUST_BE_FUTURE = 'expiresAt must be a future time'

/**
 * Decide whether a delegated instance-permission grant may proceed.
 * Clearing (`permissions` empty) does not require expiry.
 */
export function decideDelegatedInstanceExpiry(input: {
  permissions: readonly string[]
  expiresAt: Date | number | null | undefined
  now?: number
}): string | null {
  if (input.permissions.length === 0) return null
  if (input.expiresAt == null) return DELEGATED_EXPIRY_REQUIRED
  const when =
    typeof input.expiresAt === 'number' ? input.expiresAt : input.expiresAt.getTime()
  if (!Number.isFinite(when) || when <= (input.now ?? Date.now())) {
    return DELEGATED_EXPIRY_MUST_BE_FUTURE
  }
  return null
}
