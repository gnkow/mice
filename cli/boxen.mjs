#!/usr/bin/env node
/**
 * boxen — run / inspect / sync Boxen jobs locally against an oxen clone.
 *
 * Typical flow (inside a clone):
 *   boxen job run --image alpine:3.20 -- touch out.txt
 *   boxen job run --sync --image alpine:3.20 -- touch out.txt
 *   boxen job sync              # sync latest job to its source branch
 *   boxen job sync main --id <id>
 *
 * Autodetects namespace, repo, cwd, and source branch:commit from the clone.
 * Overrides: --namespace --repo --source
 *
 * Auth: BOXEN_PAT or --token (Settings → CLI tokens).
 */

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, requireFlag } from './lib/args.mjs'
import { api } from './lib/api.mjs'
import {
  authHostFromRemote,
  resolveRemote,
  resolveToken,
} from './lib/config.mjs'
import { cmdLogin, cmdLogout, cmdWhoami } from './lib/login.mjs'
import {
  materializeWorkCopy,
  pathHashesFromSnapshot,
  pullImage,
  runDockerJob,
  applyOutputsToClone,
} from './lib/docker.mjs'
import {
  cleanJobWork,
  ensureJobDir,
  isResettableLocalJob,
  listLocalJobs,
  readLocalJob,
  removeLocalJob,
  writeLocalJob,
} from './lib/localStore.mjs'
import {
  currentBranch,
  detectRemote,
  ensureOxenAuth,
  ensureOxenIdentity,
  findOxenRoot,
  headCommit,
  isWorktreeClean,
  looksLikeDirectOxenServer,
  oxenAdd,
  oxenCommit,
  oxenRestore,
  oxenVersion,
  relWorkdir,
  rewriteArgsForBff,
  runOxenPassthrough,
} from './lib/oxen.mjs'
import { pickJobForSync, syncJob } from './lib/sync.mjs'

function usage(code = 1) {
  console.error(`boxen — Oxen CLI via the Boxen auth BFF + local jobs

Usage:
  boxen login [--remote URL] [--no-open]
  boxen logout
  boxen whoami
  boxen remote
  boxen version
  boxen <oxen command> [args…]

  boxen job run    [--remote <url>] [--token <pat>]
                   [--namespace <ns>] [--repo <repo>]
                   [--source <branch|commit|branch:commit>]
                   [--name <label>] [--sync]
                   --image <image>
                   [--timeout <sec>] [--cpu <n>] [--memory <size>]
                   -- <command> [args...]

  boxen job sync   [<branch>] [--id <jobId>]
                   [--remote <url>] [--token <pat>]

  boxen job reset  [--id <jobId>] [--all] [--purge]
                   [--remote <url>] [--token <pat>]

  boxen job list   [--remote <url>] [--token <pat>]
                   [--namespace <ns>] [--repo <repo>]
  boxen job status --id <jobId> [--remote <url>] [--token <pat>]
  boxen job logs   --id <jobId> [--remote <url>] [--token <pat>]
  boxen job cancel --id <jobId> [--remote <url>] [--token <pat>]

Env: BOXEN_REMOTE, BOXEN_PAT

Inside an oxen clone, namespace/repo/source are detected automatically.
Results commit locally on the source branch (no boxen/job/* branches).
--sync pushes to the source branch when FF or clean merge is possible.

boxen job sync [<branch>] syncs the latest (or --id) local job and its
ancestor jobs in the sequential chain.

boxen job reset clears stuck/failed local job state after a run or sync
error (work dir, BFF running→failed, dirty worktree). --purge deletes
local job metadata; --all resets every resettable local job.
`)
  process.exit(code)
}

function jobSummary(job, extra = {}) {
  return {
    id: job.id,
    name: job.name || null,
    status: job.status,
    runner: job.runner === 'kubernetes' ? 'cluster' : 'local',
    runner_backend: job.runner || 'cli',
    source_ref: job.source_ref,
    sync_branch: job.sync_branch || null,
    pin_commit: job.pin_commit,
    result_commit: job.result_commit ?? null,
    result_branch: job.result_branch ?? null,
    exit_code: job.exit_code ?? null,
    error: job.error ?? null,
    image: job.image,
    ...extra,
  }
}

function resolveAuth(flags) {
  const remote = resolveRemote({
    remote: flags.remote ? String(flags.remote) : undefined,
  })
  const token = String(
    flags.token || resolveToken() || '',
  )
  if (!token) {
    console.error('Not logged in. Run: boxen login (or set --token / BOXEN_PAT)')
    usage(1)
  }
  return { remote, token }
}

function detectContext(flags) {
  const root = findOxenRoot(process.cwd())
  if (!root) {
    if (!flags.namespace || !flags.repo || !flags.source) {
      console.error(
        'Not inside an oxen clone. Run from a clone, or pass --namespace --repo --source',
      )
      usage(1)
    }
    return {
      root: process.cwd(),
      namespace: String(flags.namespace),
      repo: String(flags.repo),
      sourceBranch: '',
      pinCommit: '',
      sourceSpec: String(flags.source),
      workdirRel: '',
      fromClone: false,
    }
  }

  const remoteInfo = detectRemote(root)
  const namespace = String(
    flags.namespace || remoteInfo?.namespace || '',
  )
  const repo = String(flags.repo || remoteInfo?.repo || '')
  if (!namespace || !repo) {
    console.error(
      'Could not detect namespace/repo from oxen remote; pass --namespace and --repo',
    )
    usage(1)
  }

  const branch = currentBranch(root)
  const commit = headCommit(root)
  let sourceSpec = flags.source ? String(flags.source) : ''
  if (!sourceSpec) {
    if (branch && commit) sourceSpec = `${branch}:${commit}`
    else if (branch) sourceSpec = branch
    else if (commit) sourceSpec = commit
    else {
      console.error('Could not detect source branch/commit; pass --source')
      usage(1)
    }
  }

  let workdirRel = ''
  try {
    workdirRel = relWorkdir(root, process.cwd())
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    usage(1)
  }

  return {
    root,
    namespace,
    repo,
    sourceBranch: branch,
    pinCommit: commit,
    sourceSpec,
    workdirRel,
    fromClone: true,
  }
}

async function cmdRun(flags, command) {
  const { remote, token } = resolveAuth(flags)
  const ctx = detectContext(flags)

  if (ctx.fromClone) {
    const clean = isWorktreeClean(ctx.root)
    if (!clean.clean) {
      console.error(`Worktree is not clean: ${clean.detail}`)
      process.exit(1)
    }
  }

  const image = requireFlag(flags, 'image', usage)
  if (!command.length) {
    console.error('Provide a command after --')
    usage(1)
  }
  if (flags.target || flags.push || flags.merge) {
    console.error(
      'Deprecated: use --sync (and boxen job sync), not --target/--push/--merge',
    )
    usage(1)
  }
  if (flags.branch || flags.pin) {
    console.error('Deprecated: use --source, not --branch/--pin')
    usage(1)
  }

  const body = {
    namespace: ctx.namespace,
    repo: ctx.repo,
    source: ctx.sourceSpec,
    image,
    command: [command[0]],
    args: command.slice(1),
    runner: 'cli',
    workdir: '/data',
  }
  if (flags.name) body.name = String(flags.name)
  if (flags.timeout) body.timeout_seconds = Number(flags.timeout)
  if (flags.cpu || flags.memory) {
    body.resources = {
      ...(flags.cpu ? { cpu: String(flags.cpu) } : {}),
      ...(flags.memory ? { memory: String(flags.memory) } : {}),
    }
  }

  const data = await api(remote, token, '/auth/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  let job = data.job
  const sourceBranch =
    (job.source_ref || '').split(':')[0] || ctx.sourceBranch || ''

  const prev = listLocalJobs(ctx.root, {
    namespace: ctx.namespace,
    repo: ctx.repo,
  }).find((j) => j.status === 'succeeded' && j.result_commit)
  const parent_job_id =
    prev && prev.result_commit === (job.pin_commit || ctx.pinCommit)
      ? prev.id
      : prev && headCommit(ctx.root) === prev.result_commit
        ? prev.id
        : null

  const local = {
    id: job.id,
    name: job.name || '',
    status: 'running',
    namespace: job.namespace,
    repo: job.repo,
    source_ref: job.source_ref,
    source_branch: sourceBranch,
    pin_commit: job.pin_commit,
    result_commit: null,
    result_branch: null,
    sync_branch: '',
    parent_job_id,
    image: job.image,
    command: job.command,
    args: job.args || [],
    created_at: job.created_at || new Date().toISOString(),
    workdir_rel: ctx.workdirRel,
  }
  writeLocalJob(ctx.root, local)

  const jobPath = ensureJobDir(ctx.root, job.id)
  const workDir = join(jobPath, 'work')
  const logPath = join(jobPath, 'job.log')

  console.error(`running ${job.id} (local) source=${job.source_ref}`)

  let exitCode = 1
  let changed = []
  let imageDigest = null
  let resultCommit = null
  let completeError = null
  let inputs = []
  let outputs = []

  try {
    pullImage(image)
    materializeWorkCopy(ctx.root, workDir)
    const result = await runDockerJob({
      jobId: job.id,
      image,
      command: job.command,
      args: job.args || [],
      workDir,
      workdir: '/data',
      cpu: job.resources?.cpu || flags.cpu || '1',
      memory: job.resources?.memory || flags.memory || '512m',
      timeoutSeconds: Number(flags.timeout || job.timeout_seconds || 3600),
      maxLogBytes: job.max_log_bytes || 2_000_000,
      logPath,
    })
    exitCode = result.exitCode
    changed = result.changed
    imageDigest = result.imageDigest
    // Without readwatch on CLI yet, inputs stay empty; outputs = changed files.
    inputs = []
    outputs = pathHashesFromSnapshot(changed, result.after)

    if (exitCode === 0 && changed.length) {
      applyOutputsToClone(ctx.root, workDir, changed)
      const ident = ensureOxenIdentity(ctx.root, job.actor || {})
      if (!ident.ok) {
        throw new Error(ident.detail)
      }
      const oxenOpts = { oxenConfigDir: ident.oxenConfigDir }
      oxenAdd(ctx.root, changed, oxenOpts)
      resultCommit = oxenCommit(
        ctx.root,
        `boxen-job ${job.id} (pin ${(job.pin_commit || '').slice(0, 12)})`,
        oxenOpts,
      )
    } else if (exitCode === 0) {
      resultCommit = job.pin_commit
    } else {
      completeError = `exit code ${exitCode}`
      try {
        const tail = readFileSync(logPath, 'utf8').trim().slice(-800)
        if (tail) completeError = `${completeError}: ${tail}`
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    exitCode = 1
    completeError = err instanceof Error ? err.message : String(err)
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  const status =
    exitCode === 0 ? 'succeeded' : completeError ? 'failed' : 'failed'
  const resultBranch = exitCode === 0 && changed.length ? sourceBranch : null

  local.status = status
  local.result_commit = resultCommit
  local.result_branch = resultBranch
  local.exit_code = exitCode
  local.error = completeError
  local.inputs = inputs
  local.outputs = outputs
  writeLocalJob(ctx.root, local)

  let logText = ''
  try {
    logText = readFileSync(logPath, 'utf8')
  } catch {
    /* ignore */
  }

  try {
    const completed = await api(
      remote,
      token,
      `/auth/jobs/${encodeURIComponent(job.id)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({
          status,
          exit_code: exitCode,
          error: completeError,
          result_commit: resultCommit,
          result_branch: resultBranch,
          inputs,
          outputs,
          image_digest: imageDigest,
          log_text: logText,
        }),
      },
    )
    if (!completed?.job) {
      throw new Error('complete response missing job')
    }
    job = completed.job
  } catch (err) {
    console.error(
      `warning: failed to report completion to BFF: ${
        err instanceof Error ? err.message : err
      }`,
    )
    job = { ...job, ...local, status, result_commit: resultCommit }
  }

  let syncExtra = {}
  if (flags.sync && status === 'succeeded' && resultCommit) {
    const syncResult = await syncJob({
      root: ctx.root,
      remote,
      token,
      job: { ...local, result_commit: resultCommit, source_ref: job.source_ref },
      explicitBranch: '',
    })
    syncExtra = {
      sync_ok: syncResult.ok,
      sync_message: syncResult.message,
      sync_branch: syncResult.sync_branch,
      synced_job_ids: syncResult.job_ids,
    }
    if (!syncResult.ok) {
      console.error(syncResult.message)
    } else {
      console.error(syncResult.message)
    }
  }

  console.log(JSON.stringify(jobSummary(job, syncExtra), null, 2))
  if (status !== 'succeeded') process.exit(1)
  if (flags.sync && syncExtra.sync_ok === false) process.exit(1)
}

async function cmdSync(flags, positionals) {
  const { remote, token } = resolveAuth(flags)
  const root = findOxenRoot(process.cwd())
  if (!root) {
    console.error('boxen job sync must be run inside an oxen clone')
    process.exit(1)
  }
  const explicitBranch = positionals[0] ? String(positionals[0]) : ''
  const job = pickJobForSync(root, flags)
  const result = await syncJob({
    root,
    remote,
    token,
    job,
    explicitBranch,
  })
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        message: result.message,
        sync_branch: result.sync_branch,
        job_ids: result.job_ids,
        job_id: job.id,
      },
      null,
      2,
    ),
  )
  if (!result.ok) process.exit(1)
}

/**
 * Reset stuck/failed job state after a run or sync error:
 * - remove disposable work/
 * - mark BFF job failed if still running/queued
 * - mark local job failed (or --purge delete metadata)
 * - restore dirty worktree to HEAD so the next run can start
 */
async function cmdReset(flags) {
  const { remote, token } = resolveAuth(flags)
  const root = findOxenRoot(process.cwd())
  if (!root) {
    console.error('boxen job reset must be run inside an oxen clone')
    process.exit(1)
  }

  const purge = !!flags.purge
  const all = !!flags.all
  let targets = []

  if (flags.id) {
    const j = readLocalJob(root, String(flags.id))
    if (!j) {
      console.error(`Local job not found: ${flags.id}`)
      process.exit(1)
    }
    targets = [j]
  } else if (all) {
    targets = listLocalJobs(root).filter(isResettableLocalJob)
  } else {
    const latest = listLocalJobs(root).find(isResettableLocalJob)
    if (!latest) {
      console.error(
        'No running/failed local jobs to reset. Pass --id <jobId> or --all.',
      )
      process.exit(1)
    }
    targets = [latest]
  }

  const results = []
  for (const job of targets) {
    const entry = {
      id: job.id,
      previous_status: job.status,
      purged: false,
      bff: null,
      worktree_restored: false,
      error: null,
    }

    try {
      cleanJobWork(root, job.id)

      // Finish BFF record if still in-flight
      let remoteStatus = null
      try {
        const data = await api(
          remote,
          token,
          `/auth/jobs/${encodeURIComponent(job.id)}`,
        )
        remoteStatus = data.job?.status ?? null
      } catch {
        /* local-only job or BFF unreachable */
      }

      if (remoteStatus === 'running' || remoteStatus === 'queued') {
        try {
          await api(
            remote,
            token,
            `/auth/jobs/${encodeURIComponent(job.id)}/complete`,
            {
              method: 'POST',
              body: JSON.stringify({
                status: 'failed',
                exit_code: 1,
                error: 'reset by user',
                result_commit: job.result_commit || null,
                result_branch: job.result_branch || null,
                inputs: job.inputs || [],
                outputs: job.outputs || [],
              }),
            },
          )
          entry.bff = 'marked_failed'
        } catch (err) {
          entry.bff = `complete_failed: ${
            err instanceof Error ? err.message : err
          }`
        }
      } else if (remoteStatus) {
        entry.bff = `unchanged:${remoteStatus}`
      } else {
        entry.bff = 'skipped'
      }

      if (purge) {
        removeLocalJob(root, job.id)
        entry.purged = true
      } else {
        writeLocalJob(root, {
          ...job,
          status: 'failed',
          error: job.error
            ? `${job.error} (reset by user)`
            : 'reset by user',
          exit_code: job.exit_code ?? 1,
          reset_at: new Date().toISOString(),
        })
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }

    results.push(entry)
  }

  // After job cleanup, restore dirty tree so the next run passes preflight
  const clean = isWorktreeClean(root)
  let worktree = { clean: clean.clean, restored: false, detail: clean.detail }
  if (!clean.clean) {
    const restored = oxenRestore(root)
    if (restored.ok) {
      const after = isWorktreeClean(root)
      worktree = {
        clean: after.clean,
        restored: true,
        detail: after.clean ? '' : after.detail,
      }
      for (const r of results) r.worktree_restored = true
    } else {
      worktree = {
        clean: false,
        restored: false,
        detail: restored.detail,
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        reset: results,
        worktree,
      },
      null,
      2,
    ),
  )

  if (results.some((r) => r.error) || (worktree.restored === false && !worktree.clean)) {
    process.exit(1)
  }
}

const BOXEN_VERSION = '0.1.0'

function parseLoginFlags(argv) {
  /** @type {{ remote?: string, open: boolean }} */
  const opts = { open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remote' && argv[i + 1]) {
      opts.remote = argv[++i]
    } else if (a.startsWith('--remote=')) {
      opts.remote = a.slice('--remote='.length)
    } else if (a === '--no-open') {
      opts.open = false
    } else if (a === '--help' || a === '-h') {
      usage(0)
    }
  }
  return opts
}

async function cmdJob(jobArgv) {
  if (!jobArgv.length || jobArgv[0] === '-h' || jobArgv[0] === '--help') {
    usage(0)
  }
  const cmd = jobArgv[0]
  const { flags, _: rest } = parseArgs(jobArgv.slice(1))

  if (cmd === 'run') {
    await cmdRun(flags, rest)
    return
  }

  if (cmd === 'sync') {
    await cmdSync(flags, rest)
    return
  }

  if (cmd === 'reset') {
    await cmdReset(flags)
    return
  }

  const { remote, token } = resolveAuth(flags)

  if (cmd === 'list') {
    const root = findOxenRoot()
    const detected = root ? detectRemote(root) : null
    const namespace = flags.namespace
      ? String(flags.namespace)
      : detected?.namespace
    const repo = flags.repo ? String(flags.repo) : detected?.repo
    if (!namespace || !repo) {
      console.error('Need --namespace and --repo (or run inside a clone)')
      usage(1)
    }
    const qs = new URLSearchParams({ namespace, repo })
    if (flags.status) qs.set('status', String(flags.status))
    const data = await api(remote, token, `/auth/jobs?${qs}`)
    const rows = (data.jobs || []).map((j) => ({
      id: j.id,
      status: j.status,
      source_ref: j.source_ref,
      sync_branch: j.sync_branch || null,
      result_branch: j.result_branch || null,
      command: [...(j.command || []), ...(j.args || [])].join(' '),
    }))
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  if (cmd === 'status') {
    const id = requireFlag(flags, 'id', usage)
    // Prefer local metadata when present
    const root = findOxenRoot()
    if (root) {
      const local = readLocalJob(root, id)
      if (local) {
        console.log(JSON.stringify(local, null, 2))
        return
      }
    }
    const data = await api(remote, token, `/auth/jobs/${encodeURIComponent(id)}`)
    console.log(JSON.stringify(data.job, null, 2))
    return
  }

  if (cmd === 'logs') {
    const id = requireFlag(flags, 'id', usage)
    const root = findOxenRoot()
    if (root) {
      const logPath = join(ensureJobDir(root, id), 'job.log')
      try {
        process.stdout.write(readFileSync(logPath, 'utf8'))
        return
      } catch {
        /* fall through to BFF */
      }
    }
    const text = await api(
      remote,
      token,
      `/auth/jobs/${encodeURIComponent(id)}/logs`,
    )
    process.stdout.write(typeof text === 'string' ? text : String(text))
    if (typeof text === 'string' && !text.endsWith('\n')) {
      process.stdout.write('\n')
    }
    return
  }

  if (cmd === 'cancel') {
    const id = requireFlag(flags, 'id', usage)
    const data = await api(
      remote,
      token,
      `/auth/jobs/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
    )
    console.log(JSON.stringify(data.job, null, 2))
    return
  }

  console.error(`Unknown job command: ${cmd}`)
  usage(1)
}

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    usage(0)
  }

  const cmd = argv[0]

  if (cmd === 'login') {
    await cmdLogin(parseLoginFlags(argv.slice(1)))
    return
  }
  if (cmd === 'logout') {
    await cmdLogout(parseLoginFlags(argv.slice(1)))
    return
  }
  if (cmd === 'whoami') {
    await cmdWhoami(parseLoginFlags(argv.slice(1)))
    return
  }
  if (cmd === 'remote') {
    const remote = resolveRemote()
    console.log(remote)
    console.log(`auth host: ${authHostFromRemote(remote)}`)
    const token = resolveToken()
    console.log(token ? 'credentials: present' : 'credentials: none')
    return
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-V') {
    console.log(`boxen ${BOXEN_VERSION}`)
    const ov = oxenVersion()
    if (ov) console.log(`oxen ${ov}`)
    else console.log('oxen: not found on PATH')
    return
  }

  if (cmd === 'job') {
    await cmdJob(argv.slice(1))
    return
  }

  // --- Oxen passthrough ---
  const remote = resolveRemote()
  if (looksLikeDirectOxenServer(remote)) {
    console.error(
      `boxen: BOXEN_REMOTE / configured remote looks like raw oxen-server (${remote}).\nUse the auth BFF remote (e.g. http://localhost:8080), not :3001.`,
    )
    process.exitCode = 1
    return
  }

  try {
    ensureOxenAuth(remote)
  } catch (err) {
    console.error(`boxen: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  const { args, rewritten, blocked } = rewriteArgsForBff(argv, remote)
  if (blocked) {
    console.error(`boxen: could not rewrite direct oxen-server URL: ${blocked}`)
    process.exitCode = 1
    return
  }
  if (rewritten) {
    console.error(`boxen: rewrote :3001 remote URL(s) to ${remote}`)
  }

  const code = await runOxenPassthrough(args)
  process.exitCode = code
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
