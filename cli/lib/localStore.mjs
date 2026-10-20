/**
 * Local job metadata under `~/.mice/jobs/<repoKey>/<jobId>/`
 * (not inside the repository). Override home with MICE_HOME.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** @returns {string} */
export function miceHome() {
  const fromEnv = process.env.MICE_HOME?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return join(homedir(), '.mice')
}

/** Stable key for a clone root path. */
export function repoJobsKey(root) {
  const abs = resolve(root)
  return createHash('sha256').update(abs).digest('hex').slice(0, 16)
}

function legacyJobsDir(root) {
  return join(root, '.mice', 'jobs')
}

export function jobsDir(root) {
  return join(miceHome(), 'jobs', repoJobsKey(root))
}

export function jobDir(root, jobId) {
  return join(jobsDir(root), jobId)
}

function legacyJobDir(root, jobId) {
  return join(legacyJobsDir(root), jobId)
}

/** Remember which clone path this cache key belongs to. */
function writeClonePointer(root) {
  const base = jobsDir(root)
  mkdirSync(base, { recursive: true })
  const pointer = join(base, 'clone.json')
  writeFileSync(
    pointer,
    JSON.stringify(
      {
        root: resolve(root),
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  )
}

export function ensureJobDir(root, jobId) {
  writeClonePointer(root)
  const d = jobDir(root, jobId)
  mkdirSync(join(d, 'work'), { recursive: true })
  return d
}

export function writeLocalJob(root, job) {
  const d = ensureJobDir(root, job.id)
  const record = {
    ...job,
    clone_root: resolve(root),
  }
  writeFileSync(join(d, 'job.json'), JSON.stringify(record, null, 2), 'utf8')
  return d
}

function readJobJson(dir) {
  const p = join(dir, 'job.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function readLocalJob(root, jobId) {
  const modern = readJobJson(jobDir(root, jobId))
  if (modern) return modern
  return readJobJson(legacyJobDir(root, jobId))
}

export function listLocalJobs(root, opts = {}) {
  const dirs = []
  const modern = jobsDir(root)
  if (existsSync(modern)) dirs.push(modern)
  const legacy = legacyJobsDir(root)
  if (existsSync(legacy) && legacy !== modern) dirs.push(legacy)

  const byId = new Map()
  for (const base of dirs) {
    let ids
    try {
      ids = readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const id of ids) {
      if (byId.has(id)) continue
      const j = readJobJson(join(base, id))
      if (!j) continue
      if (opts.namespace && j.namespace !== opts.namespace) continue
      if (opts.repo && j.repo !== opts.repo) continue
      byId.set(id, j)
    }
  }

  const jobs = [...byId.values()]
  jobs.sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || '')),
  )
  return jobs
}

function commitsEqualLocal(a, b) {
  const x = String(a || '')
    .trim()
    .toLowerCase()
  const y = String(b || '')
    .trim()
    .toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  const n = Math.min(x.length, y.length)
  return n >= 7 && (x.startsWith(y) || y.startsWith(x))
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
          (commitsEqualLocal(next.pin_commit, prev.result_commit) ||
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

/** Mark jobs as published to the BFF after a successful push. */
export function markLocalPublished(root, jobIds, pushBranch) {
  for (const id of jobIds) {
    const j = readLocalJob(root, id)
    if (!j) continue
    writeLocalJob(root, {
      ...j,
      sync_branch: pushBranch,
      published: true,
      published_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    })
  }
}

/** @deprecated use markLocalPublished */
export function markLocalSynced(root, jobIds, syncBranch) {
  return markLocalPublished(root, jobIds, syncBranch)
}

/** Remove disposable work/ copy for a job (keeps job.json + logs). */
export function cleanJobWork(root, jobId) {
  const work = join(jobDir(root, jobId), 'work')
  rmSync(work, { recursive: true, force: true })
  const legacyWork = join(legacyJobDir(root, jobId), 'work')
  rmSync(legacyWork, { recursive: true, force: true })
}

/** Delete the entire local job directory. */
export function removeLocalJob(root, jobId) {
  rmSync(jobDir(root, jobId), { recursive: true, force: true })
  rmSync(legacyJobDir(root, jobId), { recursive: true, force: true })
}

/** Jobs that are stuck or failed and may need reset. */
export function isResettableLocalJob(job) {
  if (!job) return false
  const s = job.status
  return s === 'running' || s === 'queued' || s === 'failed' || s === 'cancelled'
}

/** Read local job.log if present. */
export function readLocalJobLog(root, jobId) {
  for (const dir of [jobDir(root, jobId), legacyJobDir(root, jobId)]) {
    const p = join(dir, 'job.log')
    if (!existsSync(p)) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      /* try next */
    }
  }
  return ''
}
