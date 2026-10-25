import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'
import { createCollection, createDocumentStore } from './stores.js'
import type { JobRun, JobStatus } from './jobsTypes.js'

const jobRows = createCollection<JobRun>(() => join(env.jobsDataDir, 'jobs.jsonl'))

const aliasStore = createDocumentStore<Record<string, string>>({
  path: () => join(env.jobsDataDir, 'job-aliases.json'),
  initial: () => ({}),
  onCorrupt: 'initial',
  // Anything but a string-to-string map of non-empty values is dropped, in memory.
  migrate(doc) {
    const raw = doc as unknown
    const clean: Record<string, string> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) clean[k] = v
    }
    for (const k of Object.keys(doc)) delete doc[k]
    Object.assign(doc, clean)
  },
})

const readAliases = (): Record<string, string> => aliasStore.read()

/** Resolve a job id through rekey aliases (provisional → result commit). */
export function resolveJobId(id: string): string {
  const aliases = readAliases()
  let cur = id
  const seen = new Set<string>()
  while (aliases[cur] && !seen.has(cur)) {
    seen.add(cur)
    cur = aliases[cur]!
  }
  return cur
}

/** Server / CLI job ids are hex only (blocks path traversal). */
export function assertSafeJobId(jobId: string): string {
  const id = String(jobId || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8,64}$/.test(id)) {
    throw new Error('invalid job id')
  }
  return id
}

export function jobsWorkDir(jobId: string): string {
  const id = assertSafeJobId(jobId)
  return join(env.jobsDataDir, 'work', id)
}

export function jobsLogPath(jobId: string): string {
  const id = assertSafeJobId(jobId)
  return join(env.jobsDataDir, 'logs', `${id}.log`)
}

export function appendJob(job: JobRun): void {
  jobRows.put(job.id, job)
}

/** Replace the stored snapshot of one job. */
export function upsertJob(job: JobRun): void {
  jobRows.put(job.id, job)
}

/** Log files stay real files (the runner streams into them); injectable so rekey failure is testable. */
export type JobLogFiles = {
  exists(path: string): boolean
  rename(from: string, to: string): void
}

const realLogFiles: JobLogFiles = { exists: existsSync, rename: renameSync }

/**
 * Replace a provisional job id with a new canonical id (local runs use the
 * result commit id). Keeps the old id resolvable via alias + renames the log.
 *
 * Ordered so the old id is resolvable at every instant, including across a crash:
 *  1. add the new record (old stays)         failure: nothing changed, throws
 *  2. repoint aliases to the new id          failure: new record removed again, throws
 *  3. drop the old record                    failure: throws; alias already resolves, old row is a harmless stale duplicate
 *  4. rename the log                         failure: tolerated, `logRenamed: false`; log_ref on the job should point at the new path
 */
export function rekeyJob(oldId: string, job: JobRun, logs: JobLogFiles = realLogFiles): { logRenamed: boolean } {
  if (oldId === job.id) {
    upsertJob(job)
    return { logRenamed: false }
  }
  const displaced = jobRows.get(job.id)
  jobRows.put(job.id, job)

  try {
    aliasStore.transaction((aliases) => {
      aliases[oldId] = job.id
      for (const [k, v] of Object.entries(aliases)) {
        if (v === oldId) aliases[k] = job.id
      }
    })
  } catch (error) {
    if (displaced) jobRows.put(job.id, displaced)
    else jobRows.remove(job.id)
    throw error
  }

  jobRows.remove(oldId)

  const oldLog = jobsLogPath(oldId)
  const newLog = jobsLogPath(job.id)
  if (oldLog === newLog || !logs.exists(oldLog)) return { logRenamed: false }
  try {
    logs.rename(oldLog, newLog)
    return { logRenamed: true }
  } catch {
    return { logRenamed: false }
  }
}

export function getJob(id: string): JobRun | null {
  const resolved = resolveJobId(id)
  return jobRows.get(resolved) ?? null
}

export type JobListQuery = {
  namespace?: string
  repo?: string
  status?: JobStatus
  pin_commit?: string
  limit?: number
  cursor?: string
}

export function listJobs(q: JobListQuery): {
  jobs: JobRun[]
  nextCursor: string | null
} {
  // Allow higher ceiling for ACL over-fetch on global list routes.
  const limit = Math.min(Math.max(1, q.limit ?? 50), 500)
  let rows = jobRows.list().sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (q.namespace) rows = rows.filter((j) => j.namespace === q.namespace)
  if (q.repo) rows = rows.filter((j) => j.repo === q.repo)
  if (q.status) rows = rows.filter((j) => j.status === q.status)
  if (q.pin_commit) rows = rows.filter((j) => j.pin_commit === q.pin_commit)

  if (q.cursor) {
    const idx = rows.findIndex((j) => j.id === q.cursor)
    if (idx >= 0) rows = rows.slice(idx + 1)
  }

  const page = rows.slice(0, limit)
  const nextCursor =
    rows.length > limit ? (page[page.length - 1]?.id ?? null) : null
  return { jobs: page, nextCursor }
}

export function ensureJobDirs(jobId: string): {
  work: string
  data: string
  log: string
} {
  const work = jobsWorkDir(jobId)
  const data = join(work, 'data')
  const log = jobsLogPath(jobId)
  mkdirSync(data, { recursive: true })
  mkdirSync(join(env.jobsDataDir, 'logs'), { recursive: true })
  return { work, data, log }
}
