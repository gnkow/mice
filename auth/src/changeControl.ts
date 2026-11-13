import { randomBytes } from 'node:crypto'
import { mutationNeedsReason } from './auditReason.js'

/** Optional client hint; when absent the BFF mints a change-control id. */
export const CHANGE_CONTROL_HEADER = 'x-mice-change-control-id'

/** Same mutation classes as the reason policy (creates never need a change-control id). */
export function mutationNeedsChangeControl(action: string): boolean {
  return mutationNeedsReason(action)
}

/**
 * Server-minted id stored on the audit event / signature.
 * Shape: `CC-YYYYMMDD-<8 hex>` (namespace pattern column removed in drizzle 0004).
 */
export function allocateChangeControlId(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const suffix = randomBytes(4).toString('hex')
  return `CC-${y}${m}${d}-${suffix}`
}

/**
 * Resolves the change-control id for a mutation.
 * When required: uses a non-empty client/declared id if present, otherwise mints one.
 */
export function resolveChangeControl(input: {
  id?: string | null
  required: boolean
}): string | undefined {
  const raw = (input.id ?? '').trim()
  if (!input.required) return raw || undefined
  return raw || allocateChangeControlId()
}
