/**
 * Publish local job metadata to the BFF after commits are pushed via Boxen.
 * Job records stay local until a successful push associates them with a remote branch tip.
 */
import { api } from './api.mjs'
import {
  collectAncestorJobs,
  listLocalJobs,
  markLocalPublished,
  readLocalJobLog,
} from './localStore.mjs'
import { currentBranch, headCommit, runOxen } from './oxen.mjs'

/** Compare commit ids allowing short vs full hex forms. */
export function commitsEqual(a, b) {
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
 * True if `ancestor` is an ancestor of (or equal to) `descendant`.
 * Matches short hashes from `oxen log --oneline` (often 7–12 chars).
 */
export function isAncestor(root, ancestor, descendant) {
  if (!ancestor || !descendant) return false
  if (commitsEqual(ancestor, descendant)) return true
  const a = String(ancestor).toLowerCase()
  const d = String(descendant).toLowerCase()

  for (const args of [
    ['merge-base', a, d],
    ['merge-base', d, a],
  ]) {
    const mb = runOxen(args, { cwd: root })
    if (mb.code !== 0 || !mb.stdout.trim()) continue
    const base = mb.stdout.trim().toLowerCase()
    if (commitsEqual(base, a)) return true
  }

  const r = runOxen(['log', d, '--oneline'], { cwd: root })
  if (r.code !== 0) return false
  const text = r.stdout.toLowerCase()
  for (const len of [7, 8, 9, 10, 12, 16, a.length]) {
    if (a.length < len) continue
    const needle = a.slice(0, len)
    const re = new RegExp(`\\b${needle}[0-9a-f]*\\b`, 'i')
    if (re.test(text)) return true
  }
  return false
}

/** Parse `oxen push [remote] [branch]` argv (flags ignored). */
export function parsePushRef(args) {
  const positional = []
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === '--' || a.startsWith('-')) {
      // skip flag and optional value for common long opts
      if (
        (a === '--remote' || a === '--branch') &&
        args[i + 1] &&
        !args[i + 1].startsWith('-')
      ) {
        i++
      }
      continue
    }
    positional.push(a)
  }
  return {
    remoteName: positional[0] || 'origin',
    branch: positional[1] || '',
  }
}

function toPublishPayload(root, job) {
  return {
    id: job.id,
    name: job.name || '',
    namespace: job.namespace,
    repo: job.repo,
    source_ref: job.source_ref,
    pin_commit: job.pin_commit,
    image: job.image,
    command: job.command || [],
    args: job.args || [],
    status: job.status,
    exit_code: job.exit_code ?? null,
    error: job.error ?? null,
    result_commit: job.result_commit ?? null,
    result_branch: job.result_branch ?? null,
    inputs: job.inputs || [],
    outputs: job.outputs || [],
    image_digest: job.image_digest ?? null,
    created_at: job.created_at,
    started_at: job.started_at ?? job.created_at ?? null,
    finished_at: job.finished_at ?? null,
    log_text: readLocalJobLog(root, job.id) || undefined,
  }
}

/**
 * After a successful `boxen push`, publish unpublished local jobs whose
 * result_commit is on the pushed tip history.
 */
export async function publishJobsAfterPush({
  root,
  remote,
  token,
  branch: branchArg,
}) {
  const branch = (branchArg || currentBranch(root) || '').trim()
  const tip = headCommit(root)
  if (!branch || !tip) {
    return { ok: true, published: [], skipped: 'no branch/tip', branch: null }
  }

  const candidates = listLocalJobs(root).filter(
    (j) =>
      j.status === 'succeeded' &&
      j.result_commit &&
      !j.published &&
      !j.sync_branch,
  )

  // Tip job = result commit is HEAD; also walk parent_job_id / pin chain so
  // sequential dependent jobs all publish together on one push.
  const tipJob =
    candidates.find((j) => commitsEqual(j.result_commit, tip)) ||
    candidates.find((j) => isAncestor(root, j.result_commit, tip))

  const byId = new Map()
  if (tipJob) {
    for (const j of collectAncestorJobs(root, tipJob)) {
      if (
        j.status === 'succeeded' &&
        j.result_commit &&
        !j.published &&
        !j.sync_branch
      ) {
        byId.set(j.id, j)
      }
    }
  }
  for (const j of candidates) {
    if (
      commitsEqual(j.result_commit, tip) ||
      isAncestor(root, j.result_commit, tip)
    ) {
      byId.set(j.id, j)
    }
  }
  const jobs = [...byId.values()]

  if (!jobs.length) {
    return {
      ok: true,
      published: [],
      skipped: candidates.length
        ? `no unpublished jobs on tip ${tip.slice(0, 12)} (${candidates.length} local succeeded)`
        : 'none',
      branch,
    }
  }

  try {
    await api(remote, token, '/auth/jobs/publish', {
      method: 'POST',
      body: JSON.stringify({
        push_branch: branch,
        jobs: jobs.map((j) => toPublishPayload(root, j)),
      }),
    })
  } catch (err) {
    return {
      ok: false,
      published: [],
      branch,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const ids = jobs.map((j) => j.id)
  markLocalPublished(root, ids, branch)
  return {
    ok: true,
    published: ids,
    branch,
    message: `Published ${ids.length} job(s) for ${branch}`,
  }
}
