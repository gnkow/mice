import { randomBytes } from 'node:crypto'
import { mutationNeedsReason } from '../../audit/index.js'
import { getDb } from '../../../db/database.js'
import { changeControlClaims } from '../../../db/schema.js'

/** Optional client hint; when absent the BFF mints a change-control id. */
export const CHANGE_CONTROL_HEADER = 'x-mice-change-control-id'

/**
 * Allowed shape for a QMS / change-control id (legacy namespace pattern).
 * Suggested form: `CC-YYYYMMDD-<8 hex>`.
 */
export const CHANGE_CONTROL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$/

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

export function normalizeChangeControlId(id: string | null | undefined): string {
  return (id ?? '').trim()
}

export function isValidChangeControlId(id: string): boolean {
  return CHANGE_CONTROL_ID_PATTERN.test(id)
}

export class DuplicateChangeControlIdError extends Error {
  readonly code = 'change_control_id_duplicate' as const
  constructor(readonly changeControlId: string) {
    super(`Change-control id already used: ${changeControlId}`)
    this.name = 'DuplicateChangeControlIdError'
  }
}

/**
 * Claims a change-control id for a signature. Throws DuplicateChangeControlIdError
 * when the id was already recorded.
 */
export async function claimChangeControlId(
  changeControlId: string,
  signatureId: string,
): Promise<void> {
  const id = normalizeChangeControlId(changeControlId)
  if (!id) return
  try {
    await getDb().insert(changeControlClaims).values({
      id,
      signatureId,
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateChangeControlIdError(id)
    throw err
  }
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let i = 0; i < 4 && current; i++) {
    if (
      current &&
      typeof current === 'object' &&
      'code' in current &&
      String((current as { code: unknown }).code) === '23505'
    ) {
      return true
    }
    current =
      current && typeof current === 'object' && 'cause' in current
        ? (current as { cause: unknown }).cause
        : undefined
  }
  return false
}

/**
 * Resolves the change-control id for a mutation.
 * When required: uses a non-empty client/declared id if present, otherwise mints one.
 * No per-namespace pattern validation.
 */
export function resolveChangeControl(input: {
  id?: string | null
  required: boolean
}): string | undefined {
  const raw = normalizeChangeControlId(input.id)
  if (!input.required) return raw || undefined
  return raw || allocateChangeControlId()
}
