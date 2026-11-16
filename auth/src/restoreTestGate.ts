import { appendAudit } from './audit.js'

export type RestoreTestStatus = {
  passed: boolean
  passedAt?: string
  recordedBy?: string
}

let status: RestoreTestStatus = { passed: false }

/** Test / boot helper to clear the in-process gate. */
export function resetRestoreTestGate(): void {
  status = { passed: false }
}

export function restoreTestStatus(): RestoreTestStatus {
  return { ...status }
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
