import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  materializeCommitClone,
  materializeWorkspaceMount,
} from './jobsOxen.js'
import { mountWorkKey, normalizeSessionMounts } from './sessionsMounts.js'
import { saveWorkspaceBaseline } from './sessionsSync.js'
import type { DesktopSession, SessionMount } from './sessionsTypes.js'

async function materializeOne(
  sessionId: string,
  mount: SessionMount,
  mountKey: string,
  destDir: string,
): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  if (mount.workspace_id) {
    const hashes = await materializeWorkspaceMount(
      mount.namespace,
      mount.repo,
      mount.workspace_id,
      destDir,
    )
    // Save baseline for sync
    saveWorkspaceBaseline(
      sessionId,
      mountKey,
      mount.workspace_id,
      mount.namespace,
      mount.repo,
      hashes,
    )
    return
  }
  if (!mount.pin_commit) {
    throw new Error(
      `pin_commit required when workspace_id is unset (${mount.namespace}/${mount.repo})`,
    )
  }
  await materializeCommitClone(
    mount.namespace,
    mount.repo,
    mount.pin_commit,
    destDir,
  )
}

/**
 * Materialize each Session mount into work/mounts/<key>/.
 * Bind when workspace_id OR pin_commit is set (fixes silent skip of workspace-only).
 */
export async function materializeSessionMounts(
  session: DesktopSession,
  workDir: string,
): Promise<SessionMount[]> {
  const mounts = normalizeSessionMounts(session)
  const mountsRoot = join(workDir, 'mounts')
  mkdirSync(mountsRoot, { recursive: true })
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i]!
    const key = mountWorkKey(m, i)
    await materializeOne(session.id, m, key, join(mountsRoot, key))
  }
  return mounts
}

/**
 * @deprecated Use materializeSessionMounts — kept for callers expecting singular API.
 */
export async function materializeSessionMount(
  session: DesktopSession,
  workDir: string,
): Promise<void> {
  await materializeSessionMounts(session, workDir)
}
