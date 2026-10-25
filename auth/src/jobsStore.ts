import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { jobAliases, jobs } from './db/schema.js'
import { env } from './env.js'
import type { JobRun, JobStatus } from './jobsTypes.js'

const toRow = (job: JobRun) => ({
  id: job.id,
  namespace: job.namespace,
  repo: job.repo,
  status: job.status,
  pinCommit: job.pin_commit,
  createdAt: new Date(job.created_at),
  body: job,
})

/** Resolve a job id through rekey aliases (provisional → result commit). */
export async function resolveJobId(id: string): Promise<string> {
  let cur = id
  const seen = new Set<string>()
  while (!seen.has(cur)) {
    seen.add(cur)
    const [row] = await getDb().select().from(jobAliases).where(eq(jobAliases.alias, cur))
    if (!row) break
    cur = row.target
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

export async function appendJob(job: JobRun): Promise<void> {
  await upsertJob(job)
}

/** Replace the stored snapshot of one job. */
export async function upsertJob(job: JobRun): Promise<void> {
  const row = toRow(job)
  await getDb().insert(jobs).values(row).onConflictDoUpdate({ target: jobs.id, set: row })
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
export async function rekeyJob(
  oldId: string,
  job: JobRun,
  logs: JobLogFiles = realLogFiles,
): Promise<{ logRenamed: boolean }> {
  if (oldId === job.id) {
    await upsertJob(job)
    return { logRenamed: false }
  }
  // One transaction: the old id resolves to a job at every instant, and a failure leaves nothing changed.
  await getDb().transaction(async (tx) => {
    const row = toRow(job)
    await tx.insert(jobs).values(row).onConflictDoUpdate({ target: jobs.id, set: row })
    await tx
      .insert(jobAliases)
      .values({ alias: oldId, target: job.id })
      .onConflictDoUpdate({ target: jobAliases.alias, set: { target: job.id } })
    await tx.update(jobAliases).set({ target: job.id }).where(eq(jobAliases.target, oldId))
    await tx.delete(jobs).where(eq(jobs.id, oldId))
  })

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

export async function getJob(id: string): Promise<JobRun | null> {
  const resolved = await resolveJobId(id)
  const [row] = await getDb().select({ body: jobs.body }).from(jobs).where(eq(jobs.id, resolved))
  return row?.body ?? null
}

export type JobListQuery = {
  namespace?: string
  repo?: string
  status?: JobStatus
  pin_commit?: string
  limit?: number
  cursor?: string
}

export async function listJobs(q: JobListQuery): Promise<{
  jobs: JobRun[]
  nextCursor: string | null
}> {
  // Allow higher ceiling for ACL over-fetch on global list routes.
  const limit = Math.min(Math.max(1, q.limit ?? 50), 500)
  const where: SQL[] = []
  if (q.namespace) where.push(eq(jobs.namespace, q.namespace))
  if (q.repo) where.push(eq(jobs.repo, q.repo))
  if (q.status) where.push(eq(jobs.status, q.status))
  if (q.pin_commit) where.push(eq(jobs.pinCommit, q.pin_commit))
  if (q.cursor) {
    const [at] = await getDb().select({ createdAt: jobs.createdAt }).from(jobs).where(eq(jobs.id, q.cursor))
    if (at) {
      where.push(
        or(lt(jobs.createdAt, at.createdAt), and(eq(jobs.createdAt, at.createdAt), lt(jobs.id, q.cursor)))!,
      )
    }
  }
  const rows = await getDb()
    .select({ id: jobs.id, body: jobs.body })
    .from(jobs)
    .where(and(...where))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit).map((r) => r.body)
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null
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
