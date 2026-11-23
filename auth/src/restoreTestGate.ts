import { appendAudit } from './audit.js'

export type RestoreTestStatus = {
  passed: boolean
  passedAt?: string
  recordedBy?: string
}

let status: RestoreTestStatus = { passed: false }
/** Once we have checked the audit trail for a prior pass, skip re-querying. */
let hydratedFromAudit = false

/**
 * Test helper: clear the in-process gate and **do not** re-read audit on the next
 * {@link loadRestoreTestStatus}. Use {@link simulateRestoreTestProcessRestart} when
 * the test needs hydration from a prior audit pass.
 */
export function resetRestoreTestGate(): void {
  status = { passed: false }
  hydratedFromAudit = true
}

/** Test helper: forget in-memory state as if the auth process just restarted. */
export function simulateRestoreTestProcessRestart(): void {
  status = { passed: false }
  hydratedFromAudit = false
}

export function restoreTestStatus(): RestoreTestStatus {
  return { ...status }
}

/**
 * Prefer the in-process flag; if unset, recover a prior pass from the audit trail
 * so auth restarts do not re-lock regulated merges after an operator already recorded one.
 */
export async function loadRestoreTestStatus(): Promise<RestoreTestStatus> {
  if (status.passed || hydratedFromAudit) return restoreTestStatus()
  hydratedFromAudit = true
  try {
    const { queryAudit } = await import('./audit.js')
    const { events } = await queryAudit({
      action: 'system.restore_test.passed',
      limit: 1,
    })
    const ev = events[0]
    if (!ev) return restoreTestStatus()
    const detail = (ev.detail ?? {}) as { passedAt?: string; recordedBy?: string }
    status = {
      passed: true,
      passedAt:
        typeof detail.passedAt === 'string' && detail.passedAt
          ? detail.passedAt
          : ev.ts,
      recordedBy:
        typeof detail.recordedBy === 'string' && detail.recordedBy
          ? detail.recordedBy
          : 'system',
    }
  } catch {
    // Audit unavailable: leave closed; callers that need the gate will 503 separately.
  }
  return restoreTestStatus()
}

/**
 * Record that a restore test passed (operator / scheduled job).
 * Visible via `restoreTestStatus` and an audit event.
 */
export async function recordRestoreTestPassed(input?: {
  recordedBy?: string
  at?: string
}): Promise<RestoreTestStatus> {
  status = {
    passed: true,
    passedAt: input?.at ?? new Date().toISOString(),
    recordedBy: input?.recordedBy ?? 'system',
  }
  hydratedFromAudit = true
  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/auth/admin/restore-test',
    status: 200,
    action: 'system.restore_test.passed',
    message: 'Restore test passed; regulated actions unlocked',
    detail: { passedAt: status.passedAt, recordedBy: status.recordedBy },
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
