import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { actorFromUser, appendAudit, type AuditVia } from './audit.js'
import { env } from './env.js'
import {
  appendLineage,
  type FileVersion,
} from './lineage.js'
import {
  createBranchFromPin,
  diffTrees,
  getEntryHash,
  materializeCommitClone,
  materializeWorkspaceMount,
  mergeBranch,
  snapshotTree,
  toPathRefs,
  uploadFileCommit,
  writePinMarker,
} from './jobsOxen.js'
import {
  getRunner,
  matchGlobs,
  startReadWatcher,
  type RunnerStartResult,
} from './jobsRunner.js'
import {
  appendJob,
  ensureJobDirs,
  getJob,
  jobsLogPath,
  listJobs,
  rekeyJob,
  upsertJob,
  type JobListQuery,
} from './jobsStore.js'
import {
  formatSourceRef,
  parseSourceSpec,
  resolveSource,
} from './jobsSource.js'
import type { JobRun, JobStatus, JobSubmitBody } from './jobsTypes.js'
import type { SessionUser } from './session.js'

const activeCancels = new Map<string, () => Promise<void>>()
let running = 0
const queue: string[] = []

function redactEnv(envMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(envMap)) {
    if (/secret|password|token|key|credential/i.test(k)) {
      out[k] = '***'
    } else {
      out[k] = v
    }
  }
  return out
}

/** Branch name from resolved `branch:commit` source_ref. */
export function branchFromSourceRef(sourceRef: string): string {
  const s = sourceRef.trim()
  const colon = s.indexOf(':')
  if (colon <= 0) return ''
  return s.slice(0, colon).trim()
}

export function normalizeJob(job: JobRun): JobRun {
  const legacyBranch =
    typeof job.branch === 'string' ? job.branch : ''
  const target = typeof job.target_branch === 'string' ? job.target_branch : ''
  const sync =
    typeof job.sync_branch === 'string' ? job.sync_branch.trim() : ''
  const pin = job.pin_commit || ''
  const source_ref =
    job.source_ref ||
    (legacyBranch && pin
      ? formatSourceRef(legacyBranch, pin)
      : pin || legacyBranch)
  const name =
    typeof job.name === 'string' && job.name.trim()
      ? job.name.trim()
      : ''
  const runner =
    job.runner === 'kubernetes' || job.runner === 'cli' ? job.runner : 'docker'
  const { branch: _legacy, ...rest } = job
  return {
    ...rest,
    name,
    target_branch: target,
    sync_branch: sync,
    source_ref,
    pin_commit: pin,
    runner,
  }
}

export function publicJob(job: JobRun): JobRun {
  const n = normalizeJob(job)
  return { ...n, env: redactEnv(n.env) }
}

export function parseSubmitBody(body: unknown): JobSubmitBody | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid body' }
  const b = body as Record<string, unknown>
  const namespace = typeof b.namespace === 'string' ? b.namespace.trim() : ''
  const repo = typeof b.repo === 'string' ? b.repo.trim() : ''
  const source =
    typeof b.source === 'string' && b.source !== 'workspace_mount'
      ? b.source.trim()
      : ''
  /** Explicit merge destination only (not legacy `branch`). */
  const target =
    typeof b.target === 'string'
      ? b.target.trim()
      : typeof b.target_branch === 'string'
        ? b.target_branch.trim()
        : ''
  const branch = typeof b.branch === 'string' ? b.branch.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const pin_commit =
    typeof b.pin_commit === 'string' ? b.pin_commit.trim() : ''
  const image = typeof b.image === 'string' ? b.image.trim() : ''
  const command = Array.isArray(b.command)
    ? b.command.filter((x): x is string => typeof x === 'string')
    : []
  if (!namespace || !repo || !image) {
    return { error: 'namespace, repo, and image are required' }
  }
  if (!source && !(pin_commit && (branch || target))) {
    return {
      error:
        'source is required (branch, commit, or branch:commit), or legacy branch+pin_commit',
    }
  }
  if (!command.length) return { error: 'command must be a non-empty array' }

  const resourcesIn =
    b.resources && typeof b.resources === 'object'
      ? (b.resources as Record<string, unknown>)
      : {}

  const source_kind =
    b.source_kind === 'workspace_mount' || b.source === 'workspace_mount'
      ? 'workspace_mount'
      : 'commit_clone'

  return {
    namespace,
    repo,
    ...(name ? { name } : {}),
    ...(source ? { source } : {}),
    ...(target ? { target } : {}),
    ...(pin_commit ? { pin_commit } : {}),
    ...(branch ? { branch } : {}),
    image,
    command,
    args: Array.isArray(b.args)
      ? b.args.filter((x): x is string => typeof x === 'string')
      : [],
    env:
      b.env && typeof b.env === 'object' && !Array.isArray(b.env)
        ? Object.fromEntries(
            Object.entries(b.env as Record<string, unknown>)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, v as string]),
          )
        : {},
    workdir: typeof b.workdir === 'string' ? b.workdir : '/data',
    input_globs: Array.isArray(b.input_globs)
      ? b.input_globs.filter((x): x is string => typeof x === 'string')
      : [],
    timeout_seconds:
      typeof b.timeout_seconds === 'number' && b.timeout_seconds > 0
        ? Math.floor(b.timeout_seconds)
        : env.jobsDefaultTimeoutSec,
    resources: {
      cpu:
        typeof resourcesIn.cpu === 'string'
          ? resourcesIn.cpu
          : env.jobsDefaultCpu,
      memory:
        typeof resourcesIn.memory === 'string'
          ? resourcesIn.memory
          : env.jobsDefaultMemory,
      disk:
        typeof resourcesIn.disk === 'string'
          ? resourcesIn.disk
          : env.jobsDefaultDisk,
    },
    max_log_bytes:
      typeof b.max_log_bytes === 'number' && b.max_log_bytes > 0
        ? Math.floor(b.max_log_bytes)
        : env.jobsDefaultMaxLogBytes,
    source_kind,
    workspace_id:
      typeof b.workspace_id === 'string' ? b.workspace_id.trim() : undefined,
    runner:
      b.runner === 'cli' || b.runner === 'docker' || b.runner === 'kubernetes'
        ? b.runner
        : undefined,
  }
}

export async function submitJob(
  user: SessionUser,
  via: AuditVia,
  body: JobSubmitBody,
): Promise<JobRun> {
  if (body.source_kind === 'workspace_mount' && !body.workspace_id) {
    throw new Error('workspace_id required when source_kind=workspace_mount')
  }

  let source_ref: string
  let pin_commit: string
  /** Merge destination — only when submit included explicit `target`. */
  let target_branch = ''

  if (body.source) {
    const parsed = parseSourceSpec(body.source)
    if ('error' in parsed) throw new Error(parsed.error)
    const resolved = await resolveSource(
      body.namespace,
      body.repo,
      parsed,
      body.target || undefined,
    )
    source_ref = resolved.source_ref
    pin_commit = resolved.pin_commit
    target_branch = body.target?.trim() || ''
  } else if (body.pin_commit && (body.branch || body.target)) {
    const sourceBranch = (body.branch || body.target || '').trim()
    pin_commit = body.pin_commit
    source_ref = formatSourceRef(sourceBranch, pin_commit)
    // Legacy `branch` alone does not request a merge; only explicit `target`.
    target_branch = body.target?.trim() || ''
  } else {
    throw new Error('source or branch+pin_commit required')
  }

  const isCli = body.runner === 'cli'
  const runnerName = isCli ? 'cli' : getRunner().name
  const id = randomBytes(8).toString('hex')
  const job: JobRun = {
    id,
    name: body.name?.trim() || '',
    status: isCli ? 'running' : 'queued',
    namespace: body.namespace,
    repo: body.repo,
    source_ref,
    pin_commit,
    target_branch: isCli ? '' : target_branch,
    sync_branch: '',
    result_commit: null,
    result_branch: null,
    image: body.image,
    image_digest: null,
    command: body.command,
    args: body.args ?? [],
    env: body.env ?? {},
    workdir: body.workdir ?? '/data',
    input_globs: body.input_globs ?? [],
    timeout_seconds: body.timeout_seconds ?? env.jobsDefaultTimeoutSec,
    resources: {
      cpu: body.resources?.cpu ?? env.jobsDefaultCpu,
      memory: body.resources?.memory ?? env.jobsDefaultMemory,
      disk: body.resources?.disk ?? env.jobsDefaultDisk,
    },
    max_log_bytes: body.max_log_bytes ?? env.jobsDefaultMaxLogBytes,
    network: 'none',
    actor: actorFromUser(user),
    via,
    inputs: [],
    outputs: [],
    created_at: new Date().toISOString(),
    started_at: isCli ? new Date().toISOString() : null,
    finished_at: null,
    exit_code: null,
    error: null,
    log_ref: jobsLogPath(id),
    source: body.source_kind ?? 'commit_clone',
    workspace_id: body.workspace_id ?? null,
    runtime_id: null,
    runner: runnerName,
  }

  appendJob(job)
  appendAudit({
    actor: job.actor,
    via,
    method: 'POST',
    path: '/auth/jobs',
    status: 201,
    action: 'job.submit',
    namespace: job.namespace,
    repo: job.repo,
    detail: {
      job_id: job.id,
      source_ref: job.source_ref,
      pin_commit: job.pin_commit,
      target_branch: job.target_branch,
      runner: job.runner,
      image: job.image,
    },
  })

  if (!isCli) {
    queue.push(id)
    void pumpQueue()
  }
  return job
}

export type JobCompleteBody = {
  status: 'succeeded' | 'failed' | 'cancelled'
  exit_code?: number | null
  error?: string | null
  result_commit?: string | null
  result_branch?: string | null
  inputs?: { path: string; hash: string }[]
  outputs?: { path: string; hash: string }[]
  image_digest?: string | null
  log_text?: string
}

type JobErr = { ok: false; error: string; status: number }
type JobOk = { ok: true; job: JobRun }

/** CLI runner reports terminal state after local Docker + oxen commit. */
export function completeCliJob(
  user: SessionUser,
  via: AuditVia,
  id: string,
  body: JobCompleteBody,
): JobOk | JobErr {
  const job = getJob(id)
  if (!job) return { ok: false, error: 'Not found', status: 404 }
  if (job.runner !== 'cli') {
    return {
      ok: false,
      error: 'Only CLI-runner jobs can be completed this way',
      status: 409,
    }
  }
  if (
    job.status === 'succeeded' ||
    job.status === 'failed' ||
    job.status === 'cancelled'
  ) {
    return { ok: false, error: 'Job already finished', status: 409 }
  }

  if (body.log_text != null) {
    try {
      const logPath = job.log_ref || jobsLogPath(job.id)
      mkdirSync(dirname(logPath), { recursive: true })
      writeFileSync(logPath, body.log_text, 'utf8')
    } catch {
      /* best-effort log upload */
    }
  }

  const updated: JobRun = {
    ...normalizeJob(job),
    status: body.status,
    exit_code: body.exit_code ?? null,
    error: body.error ?? null,
    result_commit: body.result_commit ?? null,
    result_branch: body.result_branch ?? null,
    inputs: Array.isArray(body.inputs) ? body.inputs : job.inputs,
    outputs: Array.isArray(body.outputs) ? body.outputs : job.outputs,
    image_digest: body.image_digest ?? job.image_digest,
    finished_at: new Date().toISOString(),
    log_ref: job.log_ref || jobsLogPath(job.id),
  }
  upsertJob(updated)
  if (updated.status === 'succeeded') appendJobLineage(updated)
  appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/jobs/${id}/complete`,
    status: 200,
    action: updated.status === 'succeeded' ? 'job.complete' : 'job.fail',
    namespace: job.namespace,
    repo: job.repo,
    detail: {
      job_id: id,
      result_commit: updated.result_commit,
      result_branch: updated.result_branch,
      error: updated.error,
    },
  })
  return { ok: true, job: updated }
}

/**
 * Mark jobs as synced to a branch (CLI sync success, including ancestors).
 */
export function markJobsSynced(
  user: SessionUser,
  via: AuditVia,
  jobIds: string[],
  syncBranch: string,
): { jobs: JobRun[] } | { error: string; status: number } {
  const branch = syncBranch.trim()
  if (!branch) return { error: 'sync_branch is required', status: 400 }
  if (!jobIds.length) return { error: 'job_ids required', status: 400 }

  const jobs: JobRun[] = []
  for (const id of jobIds) {
    const job = getJob(id)
    if (!job) return { error: `Not found: ${id}`, status: 404 }
    const updated: JobRun = {
      ...normalizeJob(job),
      sync_branch: branch,
    }
    upsertJob(updated)
    jobs.push(publicJob(updated))
  }
  appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: '/auth/jobs/sync',
    status: 200,
    action: 'job.sync',
    detail: { job_ids: jobIds, sync_branch: branch },
  })
  return { jobs }
}

export function listJobsPublic(q: JobListQuery) {
  const { jobs, nextCursor } = listJobs(q)
  return { jobs: jobs.map(publicJob), nextCursor }
}

export function getJobPublic(id: string): JobRun | null {
  const j = getJob(id)
  return j ? publicJob(j) : null
}

export function readJobLogs(id: string): string | null {
  const j = getJob(id)
  if (!j?.log_ref) return null
  try {
    return readFileSync(j.log_ref, 'utf8')
  } catch {
    return ''
  }
}

export async function cancelJob(
  user: SessionUser,
  via: AuditVia,
  id: string,
): Promise<JobOk | JobErr> {
  const job = getJob(id)
  if (!job) return { ok: false, error: 'Not found', status: 404 }
  if (
    job.status === 'succeeded' ||
    job.status === 'failed' ||
    job.status === 'cancelled'
  ) {
    return { ok: false, error: 'Job already finished', status: 409 }
  }

  const cancel = activeCancels.get(id)
  if (cancel) await cancel()

  // Remove from queue if still queued
  const qi = queue.indexOf(id)
  if (qi >= 0) queue.splice(qi, 1)

  const updated: JobRun = {
    ...job,
    status: 'cancelled',
    finished_at: new Date().toISOString(),
    error: 'cancelled',
  }
  upsertJob(updated)
  appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/jobs/${id}/cancel`,
    status: 200,
    action: 'job.cancel',
    namespace: job.namespace,
    repo: job.repo,
    detail: { job_id: id, pin_commit: job.pin_commit },
  })
  return { ok: true, job: updated }
}

async function pumpQueue() {
  while (running < env.jobsMaxConcurrent && queue.length) {
    const id = queue.shift()
    if (!id) break
    running += 1
    void executeJob(id).finally(() => {
      running -= 1
      void pumpQueue()
    })
  }
}

async function executeJob(id: string) {
  let job = getJob(id)
  if (!job || job.status === 'cancelled') return

  job = {
    ...job,
    status: 'running',
    started_at: new Date().toISOString(),
  }
  upsertJob(job)

  const { data, work, log } = ensureJobDirs(id)
  const runner = getRunner()
  let runtime: RunnerStartResult | null = null

  try {
    const digest = await runner.pullAndValidateImage(job.image)
    job = { ...job, image_digest: digest }
    upsertJob(job)

    const before =
      job.source === 'workspace_mount' && job.workspace_id
        ? await materializeWorkspaceMount(
            job.namespace,
            job.repo,
            job.workspace_id,
            data,
          )
        : await materializeCommitClone(
            job.namespace,
            job.repo,
            job.pin_commit,
            data,
          )
    writePinMarker(data, job.pin_commit, job.id)

    const watcher = startReadWatcher(data)
    runtime = await runner.start({ job, dataDir: data, logPath: log })
    job = { ...job, runtime_id: runtime.runtimeId, log_ref: log }
    upsertJob(job)
    activeCancels.set(id, runtime.cancel)

    const { exitCode } = await runtime.wait
    activeCancels.delete(id)

    const current = getJob(id)
    if (current?.status === 'cancelled') {
      cleanupWork(work)
      return
    }

    const observedReads = matchGlobs(watcher.stop(), job.input_globs)
    const after = snapshotTree(data)
    // Ignore marker dir
    after.delete('.boxen-job/pin.json')
    const diff = diffTrees(before, after)

    // Inputs are observed reads of pin/pre-job files only (not new outputs).
    const inputRefs = toPathRefs(
      observedReads.filter((p) => before.has(p)),
      before,
    )

    if (exitCode !== 0) {
      let failDetail = `exit code ${exitCode}`
      try {
        const logTail = readFileSync(log, 'utf8').trim().slice(-800)
        if (logTail) failDetail = `${failDetail}: ${logTail}`
      } catch {
        /* ignore */
      }
      job = {
        ...job,
        status: 'failed',
        exit_code: exitCode,
        finished_at: new Date().toISOString(),
        inputs: inputRefs,
        outputs: [],
        error: failDetail,
      }
      upsertJob(job)
      appendJobLineage(job)
      appendAudit({
        actor: job.actor,
        via: job.via,
        method: 'POST',
        path: `/auth/jobs/${id}`,
        status: 200,
        action: 'job.fail',
        namespace: job.namespace,
        repo: job.repo,
        detail: {
          job_id: id,
          pin_commit: job.pin_commit,
          exit_code: exitCode,
        },
      })
      cleanupWork(work)
      return
    }

    const changed = [...diff.added, ...diff.modified]
    let resultCommit: string | null = null
    let resultBranch: string | null = null
    const outputRefs: { path: string; hash: string }[] = []
    let terminal: JobStatus = 'succeeded'
    let terminalError: string | null = job.error

    if (changed.length) {
      const author = {
        name: job.actor.name || job.actor.email || 'boxen',
        email: job.actor.email || 'boxen@localhost',
      }
      const message = `boxen-job ${job.id} (pin ${job.pin_commit.slice(0, 12)})`

      // Always commit on boxen/job/<id> branched from the pin.
      resultBranch = `boxen/job/${job.id}`
      const sourceBranch = branchFromSourceRef(job.source_ref)
      await createBranchFromPin(
        job.namespace,
        job.repo,
        resultBranch,
        job.pin_commit,
        sourceBranch || undefined,
      )

      let lastCommit: string | undefined
      let committedAny = false
      for (const path of changed) {
        const uploaded = await uploadFileCommit(
          job.namespace,
          job.repo,
          resultBranch,
          path,
          `${data}/${path}`,
          message,
          author,
        )
        if (uploaded.kind === 'unchanged') continue
        committedAny = true
        lastCommit = uploaded.commitId
        const h =
          (lastCommit &&
            (await getEntryHash(
              job.namespace,
              job.repo,
              lastCommit,
              path,
            ))) ||
          after.get(path) ||
          ''
        outputRefs.push({ path, hash: h })
      }
      resultCommit = lastCommit ?? null

      if (!committedAny) {
        resultBranch = null
        resultCommit = null
      } else {
        const mergeTo = (job.target_branch || '').trim()
        if (mergeTo) {
          try {
            const merged = await mergeBranch(
              job.namespace,
              job.repo,
              mergeTo,
              resultBranch,
              author,
            )
            if (merged) resultCommit = merged
          } catch (err) {
            terminal = 'failed'
            terminalError = `committed to ${resultBranch}; merge to ${mergeTo} failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          }
        }
      }
    }

    // Local (Docker) runs: canonical job id is the result commit id.
    const provisionalId = job.id
    let canonicalId = provisionalId
    if (resultCommit && job.runner === 'docker') {
      canonicalId = resultCommit
      const commitBranch = `boxen/job/${resultCommit}`
      if (resultBranch && resultBranch !== commitBranch) {
        try {
          await createBranchFromPin(
            job.namespace,
            job.repo,
            commitBranch,
            resultCommit,
            resultBranch,
          )
          resultBranch = commitBranch
        } catch {
          /* keep provisional branch name; id still becomes the commit */
        }
      } else if (!resultBranch) {
        resultBranch = commitBranch
      }
    }

    job = {
      ...job,
      id: canonicalId,
      status: terminal,
      exit_code: 0,
      finished_at: new Date().toISOString(),
      result_commit: resultCommit,
      result_branch: resultBranch,
      inputs: inputRefs,
      outputs: outputRefs,
      error: terminalError,
      log_ref:
        canonicalId !== provisionalId ? jobsLogPath(canonicalId) : job.log_ref,
    }
    if (canonicalId !== provisionalId) {
      rekeyJob(provisionalId, job)
    } else {
      upsertJob(job)
    }
    appendJobLineage(job)
    appendAudit({
      actor: job.actor,
      via: job.via,
      method: 'POST',
      path: `/auth/jobs/${canonicalId}`,
      status: terminal === 'succeeded' ? 200 : 500,
      action: terminal === 'succeeded' ? 'job.complete' : 'job.fail',
      namespace: job.namespace,
      repo: job.repo,
      detail: {
        job_id: canonicalId,
        provisional_job_id:
          canonicalId !== provisionalId ? provisionalId : undefined,
        pin_commit: job.pin_commit,
        result_commit: resultCommit,
        result_branch: resultBranch,
        target_branch: job.target_branch || null,
        error: terminalError,
      },
    })
    cleanupWork(work)
  } catch (err) {
    activeCancels.delete(id)
    const current = getJob(id)
    if (current?.status === 'cancelled') {
      cleanupWork(work)
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    job = {
      ...(getJob(id) ?? job),
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: message,
    }
    upsertJob(job)
    appendAudit({
      actor: job.actor,
      via: job.via,
      method: 'POST',
      path: `/auth/jobs/${id}`,
      status: 500,
      action: 'job.fail',
      namespace: job.namespace,
      repo: job.repo,
      detail: { job_id: id, pin_commit: job.pin_commit, error: message },
    })
    cleanupWork(work)
  }
}

function cleanupWork(work: string) {
  try {
    rmSync(work, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function appendJobLineage(job: JobRun) {
  const inputs: FileVersion[] = job.inputs.map((i) => ({
    namespace: job.namespace,
    repo: job.repo,
    path: i.path,
    contentHash: i.hash || undefined,
    commitId: job.pin_commit,
  }))
  const outputs: FileVersion[] = job.outputs.map((o) => ({
    namespace: job.namespace,
    repo: job.repo,
    path: o.path,
    contentHash: o.hash || undefined,
    commitId: job.result_commit ?? undefined,
  }))

  appendLineage({
    kind: 'job',
    namespace: job.namespace,
    repo: job.repo,
    branch:
      normalizeJob(job).sync_branch ||
      job.result_branch ||
      branchFromSourceRef(job.source_ref) ||
      normalizeJob(job).target_branch,
    inputs,
    outputs,
    actor: job.actor,
    via: job.via,
    commitId: job.result_commit ?? undefined,
    source: 'explicit',
    confidence: 'high',
    detail: {
      job_id: job.id,
      pin_commit: job.pin_commit,
      result_commit: job.result_commit,
      status: job.status,
      image: job.image,
      image_digest: job.image_digest,
    },
  })
}

/** Resume queued jobs after process restart. */
export function resumeQueuedJobs() {
  const { jobs } = listJobs({ status: 'queued', limit: 100 })
  for (const j of jobs) {
    if (!queue.includes(j.id)) queue.push(j.id)
  }
  const runningStuck = listJobs({ status: 'running', limit: 100 }).jobs
  for (const j of runningStuck) {
    upsertJob({
      ...j,
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: 'interrupted by auth restart',
    })
  }
  void pumpQueue()
}
