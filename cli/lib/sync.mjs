/**
 * Sync local job result commit to a remote branch tip (FF or clean merge).
 *
 * Target resolution: explicit arg → job recorded source branch.
 * Never uses the current checkout branch as a fallback.
 */
import { api } from './api.mjs'
import {
  collectAncestorJobs,
  listLocalJobs,
  markLocalSynced,
  readLocalJob,
} from './localStore.mjs'
import {
  currentBranch,
  headCommit,
  oxenCheckout,
  oxenCheckoutBranch,
  oxenFetch,
  oxenMerge,
  oxenPush,
  runOxen,
} from './oxen.mjs'

export function sourceBranchOf(job) {
  const s = String(job?.source_ref || '').trim()
  const colon = s.indexOf(':')
  if (colon > 0) return s.slice(0, colon).trim()
  if (typeof job?.source_branch === 'string') return job.source_branch.trim()
  return ''
}

/** Resolve sync target: explicit arg → job recorded source branch. */
export function resolveSyncTarget(job, explicitBranch) {
  const explicit = String(explicitBranch || '').trim()
  if (explicit) return explicit
  return sourceBranchOf(job)
}

function remoteTipCommit(root, branch) {
  oxenFetch(root)
  for (const args of [
    ['log', `origin/${branch}`, '-n', '1', '--oneline'],
    ['log', branch, '-n', '1', '--oneline'],
  ]) {
    const r = runOxen(args, { cwd: root })
    if (r.code === 0 && r.stdout) {
      const hex = r.stdout.match(/\b([0-9a-f]{16,64})\b/i)
      if (hex) return hex[1].toLowerCase()
    }
  }
  return ''
}

function isAncestor(root, ancestor, descendant) {
  if (!ancestor || !descendant) return false
  if (ancestor.toLowerCase() === descendant.toLowerCase()) return true
  const r = runOxen(['log', descendant], { cwd: root })
  if (r.code !== 0) return false
  const a = ancestor.toLowerCase()
  return r.stdout.toLowerCase().includes(a.slice(0, Math.min(12, a.length)))
}

function restoreCheckout(root, branch, commit) {
  try {
    if (branch) oxenCheckout(root, branch)
    else if (commit) oxenCheckout(root, commit)
  } catch {
    /* best-effort */
  }
}

/**
 * Move/create local branch `target` to point at `resultCommit`, then push.
 */
function ffPush(root, target, resultCommit) {
  oxenCheckoutBranch(root, target)
  if (headCommit(root).toLowerCase() !== resultCommit.toLowerCase()) {
    // Checkout result commit then force branch tip (oxen: checkout -B analog)
    oxenCheckout(root, resultCommit)
    const r = runOxen(['checkout', '-b', target], { cwd: root })
    if (r.code !== 0) {
      // Branch exists: merge result (should FF)
      oxenCheckout(root, target)
      const m = oxenMerge(root, resultCommit)
      if (!m.ok) throw new Error(m.detail || 'fast-forward merge failed')
    }
  }
  oxenPush(root, 'origin', target)
}

/**
 * Merge resultCommit into target (at remote tip), then push.
 */
function mergePush(root, target, tip, resultCommit) {
  oxenCheckoutBranch(root, target)
  if (tip && headCommit(root).toLowerCase() !== tip.toLowerCase()) {
    try {
      oxenCheckout(root, tip)
      const r = runOxen(['checkout', '-b', target], { cwd: root })
      if (r.code !== 0) {
        oxenCheckout(root, target)
        const m = oxenMerge(root, tip)
        if (!m.ok) throw new Error(`align to remote tip failed: ${m.detail}`)
      }
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'align to remote tip failed',
      )
    }
  }
  const tmp = `boxen-sync-${resultCommit.slice(0, 8)}`
  runOxen(['branch', '-D', tmp], { cwd: root })
  let created = runOxen(['checkout', '-b', tmp, resultCommit], { cwd: root })
  if (created.code !== 0) {
    oxenCheckout(root, resultCommit)
    created = runOxen(['checkout', '-b', tmp], { cwd: root })
    if (created.code !== 0) {
      throw new Error(`cannot create temp branch at result: ${created.stderr}`)
    }
  }
  oxenCheckout(root, target)
  const merged = oxenMerge(root, tmp)
  runOxen(['branch', '-D', tmp], { cwd: root })
  if (!merged.ok) {
    return { ok: false, detail: merged.detail }
  }
  oxenPush(root, 'origin', target)
  return { ok: true }
}

/**
 * Sync job J's result to target branch T (and mark ancestor jobs synced).
 */
export async function syncJob({ root, remote, token, job, explicitBranch }) {
  const target = resolveSyncTarget(job, explicitBranch)
  if (!target) {
    return {
      ok: false,
      message:
        'No sync target branch: pass a branch argument or ensure the job recorded a source branch',
      sync_branch: null,
      job_ids: [],
    }
  }

  const resultCommit = job.result_commit
  if (!resultCommit) {
    return {
      ok: false,
      message: `Job ${job.id} has no result_commit to sync`,
      sync_branch: null,
      job_ids: [],
    }
  }

  const ancestors = collectAncestorJobs(root, job)
  const jobIds = ancestors.map((j) => j.id)
  const savedBranch = currentBranch(root)
  const savedHead = headCommit(root)

  try {
    const tip = remoteTipCommit(root, target)

    if (tip && tip.toLowerCase() === resultCommit.toLowerCase()) {
      // already at tip
    } else if (!tip || isAncestor(root, tip, resultCommit)) {
      ffPush(root, target, resultCommit)
    } else if (isAncestor(root, resultCommit, tip)) {
      // remote already ahead including our result — mark synced
    } else {
      const merged = mergePush(root, target, tip, resultCommit)
      if (!merged.ok) {
        return {
          ok: false,
          message:
            `Cannot sync to ${target}: merge into remote tip has conflicts.\n` +
            `Local result commit ${resultCommit.slice(0, 12)} kept; remote unchanged.\n` +
            (merged.detail ? `Detail: ${merged.detail}\n` : '') +
            `Resolve conflicts manually, then retry: boxen job sync ${target} --id ${job.id}`,
          sync_branch: null,
          job_ids: jobIds,
        }
      }
    }
  } catch (err) {
    restoreCheckout(root, savedBranch, savedHead)
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      sync_branch: null,
      job_ids: jobIds,
    }
  }

  restoreCheckout(root, savedBranch, savedHead)
  markLocalSynced(root, jobIds, target)

  try {
    await api(remote, token, '/auth/jobs/sync', {
      method: 'POST',
      body: JSON.stringify({ job_ids: jobIds, sync_branch: target }),
    })
  } catch (err) {
    console.error(
      `warning: remote sync metadata update failed: ${
        err instanceof Error ? err.message : err
      }`,
    )
  }

  return {
    ok: true,
    message: `Synced ${jobIds.length} job(s) to ${target}`,
    sync_branch: target,
    job_ids: jobIds,
  }
}

export function pickJobForSync(root, flags) {
  const id = flags.id ? String(flags.id) : ''
  if (id) {
    const j = readLocalJob(root, id)
    if (!j) throw new Error(`Local job not found: ${id}`)
    return j
  }
  const jobs = listLocalJobs(root).filter(
    (j) => j.status === 'succeeded' && j.result_commit,
  )
  if (!jobs.length) {
    throw new Error('No local succeeded jobs with a result commit to sync')
  }
  return jobs[0]
}
