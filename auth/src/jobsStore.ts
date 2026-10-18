import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'
import type { JobRun, JobStatus } from './jobsTypes.js'

function storePath(): string {
  return join(env.jobsDataDir, 'jobs.jsonl')
}

function aliasPath(): string {
  return join(env.jobsDataDir, 'job-aliases.json')
}

function readAliases(): Record<string, string> {
  const p = aliasPath()
  if (!existsSync(p)) return {}
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeAliases(aliases: Record<string, string>): void {
  mkdirSync(env.jobsDataDir, { recursive: true })
  writeFileSync(aliasPath(), `${JSON.stringify(aliases, null, 2)}\n`, 'utf8')
}

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
  const p = storePath()
  mkdirSync(env.jobsDataDir, { recursive: true })
  appendFileSync(p, `${JSON.stringify(job)}\n`, 'utf8')
}

function readAll(): JobRun[] {
  const p = storePath()
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const byId = new Map<string, JobRun>()
  for (const line of lines) {
    try {
      const j = JSON.parse(line) as JobRun
      if (j?.id) byId.set(j.id, j)
    } catch {
      /* skip bad line */
    }
  }
  return [...byId.values()]
}

/** Rewrite store with latest snapshot per id (compaction). */
export function upsertJob(job: JobRun): void {
  const all = readAll()
  const next = all.filter((j) => j.id !== job.id)
  next.push(job)
  const p = storePath()
  mkdirSync(env.jobsDataDir, { recursive: true })
  writeFileSync(
    p,
    next.map((j) => JSON.stringify(j)).join('\n') + (next.length ? '\n' : ''),
    'utf8',
  )
}

/**
 * Replace a provisional job id with a new canonical id (local runs use the
 * result commit id). Keeps the old id resolvable via alias + renames the log.
 */
export function rekeyJob(oldId: string, job: JobRun): void {
  if (oldId === job.id) {
    upsertJob(job)
    return
  }
  const all = readAll().filter((j) => j.id !== oldId && j.id !== job.id)
  all.push(job)
  const p = storePath()
  mkdirSync(env.jobsDataDir, { recursive: true })
  writeFileSync(
    p,
    all.map((j) => JSON.stringify(j)).join('\n') + (all.length ? '\n' : ''),
    'utf8',
  )

  const aliases = readAliases()
  aliases[oldId] = job.id
  for (const [k, v] of Object.entries(aliases)) {
    if (v === oldId) aliases[k] = job.id
  }
  writeAliases(aliases)

  const oldLog = jobsLogPath(oldId)
  const newLog = jobsLogPath(job.id)
  if (oldLog !== newLog && existsSync(oldLog)) {
    try {
      renameSync(oldLog, newLog)
    } catch {
      /* keep old path; log_ref on job should already point at newLog */
    }
  }
}

export function getJob(id: string): JobRun | null {
  const resolved = resolveJobId(id)
  return readAll().find((j) => j.id === resolved) ?? null
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
  let jobs = readAll().sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (q.namespace) jobs = jobs.filter((j) => j.namespace === q.namespace)
  if (q.repo) jobs = jobs.filter((j) => j.repo === q.repo)
  if (q.status) jobs = jobs.filter((j) => j.status === q.status)
  if (q.pin_commit) jobs = jobs.filter((j) => j.pin_commit === q.pin_commit)

  if (q.cursor) {
    const idx = jobs.findIndex((j) => j.id === q.cursor)
    if (idx >= 0) jobs = jobs.slice(idx + 1)
  }

  const page = jobs.slice(0, limit)
  const nextCursor =
    jobs.length > limit ? (page[page.length - 1]?.id ?? null) : null
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
