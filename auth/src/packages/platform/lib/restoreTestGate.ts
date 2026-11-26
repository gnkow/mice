import { eq } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { restoreTestStatusTable } from '../../../db/schema.js'

export type RestoreTestStatus = {
  passed: boolean
  passedAt?: string
  recordedBy?: string
}

const ROW_ID = 'instance'

let status: RestoreTestStatus = { passed: false }
/** Once we have checked durable state for a prior pass, skip re-querying. */
let hydrated = false

/**
 * Test helper: clear the in-process gate and **do not** re-read durable state on the next
 * {@link loadRestoreTestStatus}. Use {@link simulateRestoreTestProcessRestart} when
 * the test needs hydration from a prior pass.
 */
export function resetRestoreTestGate(): void {
  status = { passed: false }
  hydrated = true
}

/** Test helper: forget in-memory state as if the auth process just restarted. */
export function simulateRestoreTestProcessRestart(): void {
  status = { passed: false }
  hydrated = false
}

export function restoreTestStatus(): RestoreTestStatus {
  return { ...status }
}

/**
 * Prefer the in-process flag; if unset, recover a prior pass from Postgres
 * so auth restarts do not re-lock regulated merges (no audit trail required).
 */
export async function loadRestoreTestStatus(): Promise<RestoreTestStatus> {
  if (status.passed || hydrated) return restoreTestStatus()
  hydrated = true
  try {
    const [row] = await getDb()
      .select()
      .from(restoreTestStatusTable)
      .where(eq(restoreTestStatusTable.id, ROW_ID))
      .limit(1)
    if (!row?.passed) return restoreTestStatus()
    status = {
      passed: true,
      ...(row.passedAt ? { passedAt: row.passedAt.toISOString() } : {}),
      ...(row.recordedBy ? { recordedBy: row.recordedBy } : {}),
    }
  } catch {
    // Store unavailable: leave closed; callers that need the gate will 503 separately.
  }
  return restoreTestStatus()
}

/**
 * Record that a restore test passed (operator / seed / scheduled job).
 * Durable in Postgres — not written to the audit ledger (setup/ops state, not a GxP mutation).
 * Operator-facing routes may still append their own human-attributed audit event.
 */
export async function recordRestoreTestPassed(input?: {
  recordedBy?: string
  at?: string
}): Promise<RestoreTestStatus> {
  const passedAt = input?.at ?? new Date().toISOString()
  const recordedBy = input?.recordedBy ?? 'system'
  status = { passed: true, passedAt, recordedBy }
  hydrated = true
  const at = new Date(passedAt)
  await getDb()
    .insert(restoreTestStatusTable)
    .values({
      id: ROW_ID,
      passed: true,
      passedAt: Number.isFinite(at.getTime()) ? at : new Date(),
      recordedBy,
    })
    .onConflictDoUpdate({
      target: restoreTestStatusTable.id,
      set: {
        passed: true,
        passedAt: Number.isFinite(at.getTime()) ? at : new Date(),
        recordedBy,
      },
    })
  return restoreTestStatus()
}

export const RESTORE_TEST_REQUIRED = 'Restore test required before the first regulated action'

/** Gate for validated-branch merge / first signature (gxp/15). */
export function decideRestoreTestGate(current: RestoreTestStatus = status): {
  allow: boolean
  detail?: string
} {
  if (current.passed) return { allow: true }
  return { allow: false, detail: RESTORE_TEST_REQUIRED }
}
