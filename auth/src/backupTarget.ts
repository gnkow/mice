import { accessSync, constants, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendAudit } from './audit.js'

const PROBE = '.mice-backup-probe'

/** Result of evaluating BACKUP_TARGET for the production start gate. */
export type BackupTargetEvaluation =
  | { ok: true; target: string }
  | { ok: false; problems: string[] }

/**
 * Single backup-target policy seam: configured, writable directory that accepts a probe write.
 * Startup gate and boot audit recording both go through this evaluation.
 */
export function evaluateBackupTarget(target: string | undefined): BackupTargetEvaluation {
  if (!target?.trim()) {
    return {
      ok: false,
      problems: ['BACKUP_TARGET must be set to a writable directory (backup target is a start gate)'],
    }
  }
  const path = target.trim()
  try {
    mkdirSync(path, { recursive: true })
    accessSync(path, constants.W_OK)
  } catch {
    return {
      ok: false,
      problems: [`BACKUP_TARGET "${path}" is not reachable or not writable`],
    }
  }
  const probe = join(path, PROBE)
  try {
    writeFileSync(probe, `${Date.now()}\n`)
    unlinkSync(probe)
  } catch {
    return {
      ok: false,
      problems: [`BACKUP_TARGET "${path}" cannot accept a write probe`],
    }
  }
  return { ok: true, target: path }
}

/** Why a backup target cannot be used. Empty when the target is configured and reachable. */
export function backupTargetProblems(target: string | undefined): string[] {
  const ev = evaluateBackupTarget(target)
  return ev.ok ? [] : ev.problems
}

/** Appends an audit event that the backup target check passed at start. */
export async function recordBackupTargetCheck(target: string): Promise<void> {
  const ev = evaluateBackupTarget(target)
  if (!ev.ok) {
    throw new Error(ev.problems.join('; '))
  }
  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/boot',
    status: 200,
    action: 'system.backup_target.check',
    message: 'Backup target configured and reachable',
    detail: { target: ev.target },
  })
}
