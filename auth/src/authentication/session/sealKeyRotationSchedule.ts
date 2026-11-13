import { appendAudit, type AuditActor } from '../../audit.js'
import { getCurrentSealKey, normalRotation } from './sealKeys.js'

/** Normal rotation is due when the current key is this old. */
export const SEAL_KEY_ROTATION_SEC = 30 * 24 * 60 * 60

const nowSec = () => Math.floor(Date.now() / 1000)

const ROTATION_ACTOR: AuditActor = {
  sub: 'seal-key-rotation',
  iss: 'urn:mice:system',
  email: '',
  name: 'Seal key rotation',
}

/** True when a key issued at `validFrom` should receive a normal rotation at `at`. */
export function isSealKeyRotationDue(validFrom: number, at: number): boolean {
  return at - validFrom >= SEAL_KEY_ROTATION_SEC
}

/**
 * One scheduled normal rotation: due-check, rotate, audit as the process actor.
 * Returns true when a rotation ran.
 */
export async function runScheduledSealKeyRotation(at: number): Promise<boolean> {
  const current = await getCurrentSealKey()
  if (!current || !isSealKeyRotationDue(current.validFrom, at)) return false
  const created = await normalRotation(at)
  await appendAudit({
    actor: ROTATION_ACTOR,
    via: 'system',
    method: 'POST',
    path: '/auth/admin/seal-keys/rotate',
    status: 200,
    action: 'seal_key.rotated',
    message: 'Normal seal key rotation completed',
    detail: {
      newKeyId: created.id,
      rotationType: 'normal',
      validFrom: created.validFrom,
    },
  })
  return true
}

/**
 * Normal seal-key rotation. A tick rotates when the current key's validFrom is
 * at least 30 days ago, so a process restart does not reset the wait.
 */
export function startSealKeyRotationSchedule(
  opts: { now?: () => number; poll?: boolean } = {},
): { tick(): Promise<boolean>; stop(): void } {
  const now = opts.now ?? nowSec
  const tick = async (): Promise<boolean> => runScheduledSealKeyRotation(now())
  const timer = opts.poll === false ? undefined : setInterval(() => void tick(), 60_000)
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}
