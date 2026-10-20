import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { diffTrees, snapshotTree } from './jobsOxen.js'
import { env } from './env.js'

type BaselineSnapshot = {
  workspaceId: string
  namespace: string
  repo: string
  snapshot: Record<string, string>
  createdAt: string
}

function baselinePath(sessionId: string, mountKey: string): string {
  const dataDir = env.sessionsDataDir
  return join(dataDir, 'baselines', `${sessionId}_${mountKey}.json`)
}

/**
 * Save baseline snapshot when a workspace mount is materialized.
 */
export function saveWorkspaceBaseline(
  sessionId: string,
  mountKey: string,
  workspaceId: string,
  namespace: string,
  repo: string,
  hashes: Map<string, string>,
): void {
  const baseline: BaselineSnapshot = {
    workspaceId,
    namespace,
    repo,
    snapshot: Object.fromEntries(hashes),
    createdAt: new Date().toISOString(),
  }
  const path = baselinePath(sessionId, mountKey)
  const dir = join(env.sessionsDataDir, 'baselines')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(baseline, null, 2))
}

/**
 * Load baseline snapshot for a workspace mount.
 */
export function loadWorkspaceBaseline(
  sessionId: string,
  mountKey: string,
): BaselineSnapshot | null {
  const path = baselinePath(sessionId, mountKey)
  if (!existsSync(path)) return null
  try {
    const data = readFileSync(path, 'utf8')
    return JSON.parse(data) as BaselineSnapshot
  } catch {
    return null
  }
}

/**
 * Get the diff for a session mount without syncing.
 */
export function getMountDiff(
  sessionId: string,
  mountKey: string,
  mountDir: string,
): {
  baseline: BaselineSnapshot | null
  added: string[]
  modified: string[]
  removed: string[]
} {
  const baseline = loadWorkspaceBaseline(sessionId, mountKey)
  if (!baseline) {
    return { baseline: null, added: [], modified: [], removed: [] }
  }

  // Snapshot current state
  const current = snapshotTree(mountDir)
  const before = new Map(Object.entries(baseline.snapshot))
  const diff = diffTrees(before, current)

  return {
    baseline,
    added: diff.added,
    modified: diff.modified,
    removed: diff.removed,
  }
}

/**
 * Sync changes from a session mount directory back to the workspace.
 * @param filesToSync - Optional array of file paths to sync. If not provided, syncs all changes.
 */
export async function syncMountToWorkspace(
  sessionId: string,
  mountKey: string,
  mountDir: string,
  filesToSync?: string[],
): Promise<{
  added: string[]
  modified: string[]
  removed: string[]
  uploaded: number
  errors: string[]
}> {
  const baseline = loadWorkspaceBaseline(sessionId, mountKey)
  if (!baseline) {
    throw new Error(
      `No baseline found for session ${sessionId} mount ${mountKey}`,
    )
  }

  // Snapshot current state
  const current = snapshotTree(mountDir)
  const before = new Map(Object.entries(baseline.snapshot))
  const diff = diffTrees(before, current)

  const errors: string[] = []
  let uploaded = 0

  // Filter by selected files if provided
  const addedToSync = filesToSync
    ? diff.added.filter((f) => filesToSync.includes(f))
    : diff.added
  const modifiedToSync = filesToSync
    ? diff.modified.filter((f) => filesToSync.includes(f))
    : diff.modified
  const removedToSync = filesToSync
    ? diff.removed.filter((f) => filesToSync.includes(f))
    : diff.removed

  // Upload added and modified files to the workspace
  const toUpload = [...addedToSync, ...modifiedToSync]
  for (const path of toUpload) {
    try {
      await uploadFileToWorkspace(
        baseline.namespace,
        baseline.repo,
        baseline.workspaceId,
        path,
        join(mountDir, path),
      )
      uploaded++
    } catch (err) {
      errors.push(
        `${path}: ${err instanceof Error ? err.message : 'upload failed'}`,
      )
    }
  }

  // Stage removals
  if (removedToSync.length > 0) {
    try {
      await stageWorkspaceRemovals(
        baseline.namespace,
        baseline.repo,
        baseline.workspaceId,
        removedToSync,
      )
    } catch (err) {
      errors.push(
        `removals: ${err instanceof Error ? err.message : 'staging failed'}`,
      )
    }
  }

  return {
    added: addedToSync,
    modified: modifiedToSync,
    removed: removedToSync,
    uploaded,
    errors,
  }
}

async function uploadFileToWorkspace(
  namespace: string,
  repo: string,
  workspaceId: string,
  filePath: string,
  localPath: string,
): Promise<void> {
  const bytes = readFileSync(localPath)
  const filename = filePath.split('/').pop() || 'file'
  const directory = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : ''

  const encNs = encodeURIComponent(namespace)
  const encRepo = encodeURIComponent(repo)
  const encWs = encodeURIComponent(workspaceId)
  const dirPart = directory
    ? `/${directory.split('/').map(encodeURIComponent).join('/')}`
    : '/'

  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)

  const url = `${env.oxenUpstream}/api/repos/${encNs}/${encRepo}/workspaces/${encWs}/files${dirPart}`
  const res = await fetch(url, { method: 'POST', body: form })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`upload failed (${res.status}): ${text}`)
  }
}

async function stageWorkspaceRemovals(
  namespace: string,
  repo: string,
  workspaceId: string,
  paths: string[],
): Promise<void> {
  const encNs = encodeURIComponent(namespace)
  const encRepo = encodeURIComponent(repo)
  const encWs = encodeURIComponent(workspaceId)

  const url = `${env.oxenUpstream}/api/repos/${encNs}/${encRepo}/workspaces/${encWs}/files`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paths),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`removal staging failed (${res.status}): ${text}`)
  }
}
