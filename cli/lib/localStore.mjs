/**
 * Local job metadata under `<oxen-root>/.boxen/jobs/`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export function jobsDir(root) {
  return join(root, '.boxen', 'jobs')
}

export function jobDir(root, jobId) {
  return join(jobsDir(root), jobId)
}

export function ensureJobDir(root, jobId) {
  const d = jobDir(root, jobId)
  mkdirSync(join(d, 'work'), { recursive: true })
  return d
}

export function writeLocalJob(root, job) {
  const d = ensureJobDir(root, job.id)
  writeFileSync(join(d, 'job.json'), JSON.stringify(job, null, 2), 'utf8')
  return d
}

export function readLocalJob(root, jobId) {
  const p = join(jobDir(root, jobId), 'job.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function listLocalJobs(root, opts = {}) {
  const base = jobsDir(root)
  if (!existsSync(base)) return []
  const ids = readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  const jobs = []
  for (const id of ids) {
    const j = readLocalJob(root, id)
    if (!j) continue
    if (opts.namespace && j.namespace !== opts.namespace) continue
    if (opts.repo && j.repo !== opts.repo) continue
    jobs.push(j)
  }
  jobs.sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')),
  )
  return jobs
}

/**
 * Ancestor jobs: prior local successes in same ns/repo whose result_commit
 * is an ancestor of tipCommit in the sequential parent chain, or whose
 * result_commit appears when walking parent_job_id links ending at tipJob.
 */
export function collectAncestorJobs(root, tipJob) {
  const all = listLocalJobs(root, {
    namespace: tipJob.namespace,
    repo: tipJob.repo,
  })
  const byId = new Map(all.map((j) => [j.id, j]))
  const chain = []
  let cur = tipJob
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.push(cur)
    const parentId = cur.parent_job_id
    if (!parentId) break
    cur = byId.get(parentId) || null
  }
  // Also include sequential jobs where result_commit of A == pin_commit of next
  // when parent_job_id was not recorded.
  if (chain.length === 1) {
    const ordered = [...all]
      .filter((j) => j.status === 'succeeded' && j.result_commit)
      .sort((a, b) =>
        String(a.created_at || '').localeCompare(String(b.created_at || '')),
      )
    const tipIdx = ordered.findIndex((j) => j.id === tipJob.id)
    if (tipIdx > 0) {
      const seq = [ordered[tipIdx]]
      for (let i = tipIdx - 1; i >= 0; i--) {
        const prev = ordered[i]
        const next = seq[0]
        if (
          prev.result_commit &&
          (next.pin_commit === prev.result_commit ||
            next.parent_job_id === prev.id)
        ) {
          seq.unshift(prev)
        } else break
      }
      return seq
    }
  }
  return chain.reverse()
}

export function markLocalSynced(root, jobIds, syncBranch) {
  for (const id of jobIds) {
    const j = readLocalJob(root, id)
    if (!j) continue
    writeLocalJob(root, { ...j, sync_branch: syncBranch, synced_at: new Date().toISOString() })
  }
}

/** Remove disposable work/ copy for a job (keeps job.json + logs). */
export function cleanJobWork(root, jobId) {
  const work = join(jobDir(root, jobId), 'work')
  rmSync(work, { recursive: true, force: true })
}

/** Delete the entire local job directory. */
export function removeLocalJob(root, jobId) {
  rmSync(jobDir(root, jobId), { recursive: true, force: true })
}

/** Jobs that are stuck or failed and may need reset. */
export function isResettableLocalJob(job) {
  if (!job) return false
  const s = job.status
  return s === 'running' || s === 'queued' || s === 'failed' || s === 'cancelled'
}
