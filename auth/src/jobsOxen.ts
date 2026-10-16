import { createHash } from 'node:crypto'
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { env } from './env.js'
import type { JobPathRef } from './jobsTypes.js'

type DirEntry = {
  filename?: string
  hash?: string
  is_dir?: boolean
  resource?: { path?: string }
}

async function oxenFetch(
  path: string,
  init?: RequestInit & { raw?: boolean },
): Promise<Response> {
  const url = `${env.oxenUpstream}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, init)
  return res
}

function encSeg(s: string): string {
  return encodeURIComponent(s)
}

function resourcePath(revision: string, filePath = ''): string {
  const parts = [revision, ...filePath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)]
  return parts.map(encSeg).join('/')
}

export async function listDirEntries(
  namespace: string,
  repo: string,
  revision: string,
  path = '',
): Promise<DirEntry[]> {
  const resource = resourcePath(revision, path)
  const pageSize = 100
  let page = 1
  const out: DirEntry[] = []
  for (;;) {
    const res = await oxenFetch(
      `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/dir/${resource}?page=${page}&page_size=${pageSize}`,
    )
    if (!res.ok) {
      throw new Error(`oxen list dir failed (${res.status}) at ${path || '/'}`)
    }
    const body = (await res.json()) as {
      entries?: DirEntry[]
      total_pages?: number
    }
    out.push(...(body.entries ?? []))
    const totalPages = body.total_pages ?? 1
    if (page >= totalPages) break
    page += 1
  }
  return out
}

async function downloadToFile(
  namespace: string,
  repo: string,
  revision: string,
  filePath: string,
  dest: string,
): Promise<void> {
  const resource = resourcePath(revision, filePath)
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/file/${resource}`,
  )
  if (!res.ok || !res.body) {
    throw new Error(`oxen download failed (${res.status}) for ${filePath}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

/** Materialize a clean tree for pin_commit into destDir. */
export async function materializeCommitClone(
  namespace: string,
  repo: string,
  pinCommit: string,
  destDir: string,
): Promise<Map<string, string>> {
  mkdirSync(destDir, { recursive: true })
  const hashes = new Map<string, string>()

  async function walk(dirPath: string) {
    const entries = await listDirEntries(namespace, repo, pinCommit, dirPath)
    for (const e of entries) {
      const name = e.filename ?? e.resource?.path?.split('/').pop()
      if (!name || name === '.oxen' || name.startsWith('.oxen')) continue
      const rel = dirPath ? `${dirPath}/${name}` : name
      if (e.is_dir) {
        mkdirSync(join(destDir, rel), { recursive: true })
        await walk(rel)
        continue
      }
      const dest = join(destDir, rel)
      await downloadToFile(namespace, repo, pinCommit, rel, dest)
      // Always content-hash locally so diffTrees matches snapshotTree (sha256).
      // Oxen entry hashes are not comparable to hashFile().
      hashes.set(rel.replace(/\\/g, '/'), hashFile(dest))
    }
  }

  await walk('')
  return hashes
}

/** Materialize workspace files when oxen workspace file listing is available. */
export async function materializeWorkspaceMount(
  namespace: string,
  repo: string,
  workspaceId: string,
  destDir: string,
): Promise<Map<string, string>> {
  mkdirSync(destDir, { recursive: true })
  const hashes = new Map<string, string>()
  // Workspace dir listing: GET …/workspaces/{id}/dir/{path}
  async function walk(dirPath: string) {
    const suffix = dirPath
      ? dirPath.split('/').filter(Boolean).map(encSeg).join('/')
      : ''
    const res = await oxenFetch(
      `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/workspaces/${encSeg(workspaceId)}/dir/${suffix}?page=1&page_size=100`,
    )
    if (!res.ok) {
      throw new Error(
        `oxen workspace dir failed (${res.status}); workspace mount unavailable`,
      )
    }
    const body = (await res.json()) as { entries?: DirEntry[] }
    for (const e of body.entries ?? []) {
      const name = e.filename
      if (!name || name.startsWith('.oxen')) continue
      const rel = dirPath ? `${dirPath}/${name}` : name
      if (e.is_dir) {
        mkdirSync(join(destDir, rel), { recursive: true })
        await walk(rel)
        continue
      }
      const fileRes = await oxenFetch(
        `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/workspaces/${encSeg(workspaceId)}/file/${rel.split('/').map(encSeg).join('/')}`,
      )
      if (!fileRes.ok || !fileRes.body) {
        throw new Error(`workspace file download failed for ${rel}`)
      }
      const dest = join(destDir, rel)
      mkdirSync(dirname(dest), { recursive: true })
      await pipeline(
        Readable.fromWeb(fileRes.body as never),
        createWriteStream(dest),
      )
      hashes.set(rel, hashFile(dest))
    }
  }
  await walk('')
  return hashes
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>()
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (name === '.oxen' || name === '.boxen-job') continue
      const full = join(dir, name)
      const st = statSync(full)
      const rel = relative(root, full).replace(/\\/g, '/')
      if (st.isDirectory()) walk(full)
      else out.set(rel, hashFile(full))
    }
  }
  walk(root)
  return out
}

export function diffTrees(
  before: Map<string, string>,
  after: Map<string, string>,
): { added: string[]; modified: string[]; removed: string[] } {
  const added: string[] = []
  const modified: string[] = []
  const removed: string[] = []
  for (const [p, h] of after) {
    const prev = before.get(p)
    if (prev === undefined) added.push(p)
    else if (prev !== h) modified.push(p)
  }
  for (const p of before.keys()) {
    if (!after.has(p)) removed.push(p)
  }
  return { added, modified, removed }
}

export type UploadCommitResult =
  | { kind: 'committed'; commitId: string | undefined }
  | { kind: 'unchanged' }

export async function uploadFileCommit(
  namespace: string,
  repo: string,
  branch: string,
  destPath: string,
  localPath: string,
  message: string,
  author: { name: string; email: string },
): Promise<UploadCommitResult> {
  const resource = resourcePath(branch, destPath)
  const bytes = new Uint8Array(readFileSync(localPath))
  const form = new FormData()
  form.append(
    'file',
    new Blob([bytes]),
    destPath.split('/').pop() || 'file',
  )
  form.append('message', message)
  form.append('name', author.name)
  form.append('email', author.email)
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/file/${resource}`,
    { method: 'PUT', body: form },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Oxen rejects identical content; treat as no-op so one false-positive
    // path does not fail the whole job.
    if (res.status === 422 && /no_changes|nothing to commit/i.test(text)) {
      return { kind: 'unchanged' }
    }
    throw new Error(`oxen upload failed (${res.status}) ${destPath}: ${text}`)
  }
  const body = (await res.json().catch(() => null)) as {
    commit?: { id?: string }
  } | null
  return { kind: 'committed', commitId: body?.commit?.id }
}

export async function createBranch(
  namespace: string,
  repo: string,
  newName: string,
  fromName: string,
): Promise<void> {
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/branches`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_name: newName, from_name: fromName }),
    },
  )
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => '')
    throw new Error(`create branch failed (${res.status})${text ? `: ${text}` : ''}`)
  }
}

/** Point an existing branch tip at a commit (Oxen PUT branch). */
export async function updateBranch(
  namespace: string,
  repo: string,
  branch: string,
  commitId: string,
): Promise<void> {
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/branches/${encSeg(branch)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit_id: commitId }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `update branch failed (${res.status})${text ? `: ${text}` : ''}`,
    )
  }
}

/**
 * Create `newName` with tip = pinCommit (parent history matches the job pin).
 * Tries `from_name=pin`; falls back to branch name + updateBranch.
 */
export async function createBranchFromPin(
  namespace: string,
  repo: string,
  newName: string,
  pinCommit: string,
  fallbackBranch?: string,
): Promise<void> {
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/branches`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_name: newName, from_name: pinCommit }),
    },
  )
  if (res.ok) return
  if (res.status === 409) {
    await updateBranch(namespace, repo, newName, pinCommit)
    return
  }
  if (!fallbackBranch) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `create branch from pin failed (${res.status})${text ? `: ${text}` : ''}`,
    )
  }
  await createBranch(namespace, repo, newName, fallbackBranch)
  await updateBranch(namespace, repo, newName, pinCommit)
}

/** Match web `baseHead` — keep `/` in branch names (do not encodeURIComponent). */
export function mergeRangePath(base: string, head: string): string {
  return `${base}..${head}`
}

export async function mergeBranch(
  namespace: string,
  repo: string,
  base: string,
  head: string,
  author: { name: string; email: string },
): Promise<string | undefined> {
  const range = mergeRangePath(base, head)
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/merge/${range}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: author.name, email: author.email }),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `merge failed (${res.status})${text ? `: ${text}` : ''}`,
    )
  }
  const body = (await res.json()) as {
    commits?: { merge?: { id?: string } }
  }
  return body.commits?.merge?.id
}

export async function getEntryHash(
  namespace: string,
  repo: string,
  revision: string,
  path: string,
): Promise<string | undefined> {
  const resource = resourcePath(revision, path)
  const res = await oxenFetch(
    `/api/repos/${encSeg(namespace)}/${encSeg(repo)}/meta/${resource}`,
  )
  if (!res.ok) return undefined
  const body = (await res.json()) as { entry?: { hash?: string } }
  return body.entry?.hash
}

export function toPathRefs(
  paths: string[],
  tree: Map<string, string>,
): JobPathRef[] {
  return paths.map((path) => ({
    path,
    hash: tree.get(path) ?? '',
  }))
}

export function writePinMarker(
  dataDir: string,
  pinCommit: string,
  jobId: string,
): void {
  const dir = join(dataDir, '.boxen-job')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pin.json'),
    JSON.stringify({ pin_commit: pinCommit, job_id: jobId }, null, 2),
  )
}
