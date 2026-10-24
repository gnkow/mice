#!/usr/bin/env node
/**
 * mice — run / inspect / sync Mice jobs locally against an oxen clone.
 *
 * Typical flow (inside a clone):
 *   mice job run --image alpine:3.20 -- touch out.txt
 *   mice push                  # pushes commits via BFF + publishes job meta
 *
 * Local job metadata: ~/.mice/jobs/ (not in the repository).
 * Jobs appear on the remote/UI when their result commit is pushed via mice.
 *
 * Autodetects namespace, repo, cwd, and source branch:commit from the clone.
 * Auth (mice login / MICE_PAT) is required to push / talk to the BFF.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, parseScope, requireFlag } from './lib/args.mjs'
import { api } from './lib/api.mjs'
import { ADMIN_GROUPS, runAdmin } from './lib/admin.mjs'
import {
  authHostFromRemote,
  resolveRemote,
  resolveToken,
} from './lib/config.mjs'
import { cmdLogin, cmdLogout, cmdWhoami } from './lib/login.mjs'
import {
  applyCreateMeta,
  cmdMeta,
  detectCreation,
  extractCreateMeta,
} from './lib/meta.mjs'
import {
  materializeWorkCopy,
  inferCommandInputPaths,
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
  readLocalJobLog,
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
  oxenPush,
  oxenRestore,
  oxenVersion,
  relWorkdir,
  rewriteArgsForBff,
  runOxenPassthrough,
} from './lib/oxen.mjs'
import { confirmOrExit } from './lib/confirm.mjs'
import {
  commitsEqual,
  parsePushRef,
  publishJobsAfterPush,
} from './lib/publish.mjs'

function usage(code = 1) {
  console.error(`mice — Oxen CLI via the Mice auth BFF + local jobs

Usage:
  mice login [--remote URL] [--no-open] [--scope <ns>[/<repo>]:<role>]…
                   --scope limits the minted token to a namespace or repo and a
                   maximum role (read|triage|write|maintain|admin). Scoped tokens
                   cannot use management commands.
  mice logout
  mice whoami
  mice remote
  mice version
  mice <oxen command> [args…]

  mice job run    [--namespace <ns>] [--repo <repo>]
                   [--source <branch|commit|branch:commit>]
                   [--name <label>] [--push]
                   [--tag <t>]… [--label <k=v>]…
                   --image <image>
                   [--timeout <sec>] [--cpu <n>] [--memory <size>]
                   -- <command> [args...]

  mice job reset  [--id <jobId>] [--all] [--purge] [--yes]
                   [--remote <url>] [--token <pat>]

  mice meta get   <type> [id] [--own] [--json]
  mice meta set   <type> [id] [--tag <t>[,<t>…]]… [--label <k=v>]…
                   [--untag <t>]… [--unlabel <k>]…
                   Path types require --scope repository|branch|commit;
                   branch/commit scopes also require --revision <name-or-id>.
  mice meta clear <type> [id] --yes
                   types: namespace repo branch commit directory file
                          workspace job session
                   ids:   ns | ns/repo | ns/repo@branch | ns/repo#commit |
                          ns/repo!workspace | ns/repo:path | ns/repo:dir/ | <jobId> | <sessionId>
                   Inside a clone, namespace/repo are filled in: bare paths,
                   branch names and commit ids work, and \`mice meta set repo\`
                   targets the current repo.

  Commands that create an entity also accept --tag / --label (repeatable):
    mice commit -m msg --tag release --label qa=ok      # commit
    mice branch dev --label stage=staging               # branch (also checkout -b)
    mice create-remote ns/repo --tag demo               # repository
    mice job run … --tag nightly                        # job (set once it is published)

  mice push       # oxen push via BFF; also publishes pending job metadata

  mice job list   [--remote <url>] [--token <pat>]
                   [--namespace <ns>] [--repo <repo>]
                   [--published [--all] [--status s] [--limit n] [--cursor c] [--pin commit]]
                   (default: local jobs; --published queries the server)
  mice job status --id <jobId> [--remote <url>] [--token <pat>]
  mice job logs   --id <jobId> [--remote <url>] [--token <pat>]
  mice job cancel --id <jobId> [--remote <url>] [--token <pat>]

  mice meta history <type> [id]
  mice meta search  [text] [--type <t>]… [--namespace ns] [--repo r]
                    [--tag t]… [--label k=v]… [--limit n] [--cursor c]

Management (via the BFF; needs mice login — scoped PATs are rejected).
Output is JSON. Most commands accept --remote / --token.
  mice authz                                  effective permissions
  mice directory <query> [--kind user|group] [--limit n]
  mice access-request submit [--message m] | list
  mice access-request approve <id> (--namespace ns --role r | --permission p)
  mice access-request deny <id>
  mice training set [--sub s --iss i] [--revoke]
  mice audit list   [--actor a] [--namespace ns] [--repo r] [--action a]
                    [--since t] [--until t] [--session-id id] [--stage-id id]
                    [--job-id id] [--via session|pat] [--limit n] [--cursor c]
  mice audit facets [--namespace ns]
  mice audit export [same filters] [--out file.csv]
  mice lineage query   --namespace ns --repo r [--path p] [--content-hash h]
                       [--direction ancestors|descendants|both] [--depth n]
                       [--since t] [--until t] [--kind k] [--job-id id]
                       [--commit c] [--limit n] [--cursor c]
  mice lineage rebuild --namespace ns --repo r --path p [--branch b]
  mice instance show | enforce on|off
  mice instance admin add|remove --sub s --iss i
  mice instance permissions set --sub s --iss i --permissions a,b,…
  mice namespace list | show <ns>
  mice namespace create <ns> --base-permission none|read|… [--members-create-repos true|false]
  mice namespace update <ns> [--base-permission p] [--members-create-repos true|false]
  mice namespace delete <ns> [--keep-repos] [--yes]
  mice namespace member set <ns> (--sub s --iss i | --group g) --role <owner|member|customId>
  mice namespace member remove <ns> (--sub s --iss i | --group g)
  mice collaborator list [ns/repo]
  mice collaborator set [ns/repo] (--sub s --iss i | --group g) --role <role>
  mice collaborator remove [ns/repo] (--sub s --iss i | --group g)
  mice role permissions|list <ns>
  mice role create <ns> namespace --name n --permissions a,b [--description d]
                       [--base-repository-role r]
  mice role create <ns> repo --name n --base read|triage|write|maintain --permissions a,b
  mice role update <ns> namespace|repo <roleId> [--name …] [--permissions …] …
  mice role delete <ns> namespace|repo <roleId> [--yes]
  mice session templates | retention | list [--all]
  mice session create [--template t] [--image i] [--cpu c] [--memory m] [--disk d]
                      [--mount w_<id>[:ro|rw]]… [--workspace w_<id>[:ro|rw]]…
                      [--new-workspace ns/repo@branch|ns/repo#commit[=name][:ro|rw]]…
                      [--recording true|false]
  mice session show|connect|disconnect|retry|stop <id>
  mice session list --workspace w_<id>
  mice session mounts <id> [--set w_x[:ro|rw]|none]… [--add w_x[:ro|rw]]… [--remove w_x]… [--new-workspace …]…
  mice session remount <id> [--workspace w_<id>] [--mount-path /data/ns/repo]
  mice workspace [list [ns/repo]] | show|changes|delete <w_id> [--yes]
  mice workspace create ns/repo [--name n] [--branch b | --commit c]
  mice session destroy <id> [--yes]
  mice notifications [list] [--unread] [--cursor c] | unread-count
  mice notifications read|unread <id> | read-all [--before iso]
  mice notifications preferences [set --json '<prefs>'] | resource-overrides
  mice favorite list [--type namespace|repo|branch|stage|job|session]
  mice favorite add|remove <type> [id]     (id defaults from the current clone)
  mice announcement list [--all]
  mice announcement create --title <t> [--message <m>] [--severity info|warning|critical] [--expires <ISO date>]   (instance admin)
  mice announcement enable|disable|delete <id>                                                                    (instance admin)
  mice notifications announce --title t --summary s     (instance admin)

  API token create/revoke and CLI device approval stay browser-only.

Env: MICE_REMOTE, MICE_PAT, MICE_HOME (default ~/.mice), MICE_YES

Inside an oxen clone, namespace/repo/source are detected automatically.
Job metadata is cached under ~/.mice/jobs/ (not in the repo).
Results commit locally on the source branch. When you mice push, matching
job metadata is published to the BFF/UI automatically.

mice job reset clears stuck/failed local job state (and may restore a dirty
worktree). Destructive resets require confirmation unless --yes is set.
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
    console.error('Not logged in. Run: mice login (or set --token / MICE_PAT)')
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
  const ctx = detectContext(flags)
  const wantPush = !!flags.push || !!flags.sync // --sync kept as alias for --push

  // Auth is only required when pushing (which also publishes job meta).
  let remote = ''
  let token = ''
  if (wantPush) {
    ;({ remote, token } = resolveAuth(flags))
  }

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
  if (flags.target || flags.merge) {
    console.error(
      'Deprecated: push with mice push (or job run --push), not --target/--merge',
    )
    usage(1)
  }
  if (flags.branch || flags.pin) {
    console.error('Deprecated: use --source, not --branch/--pin')
    usage(1)
  }
  if (flags.sync) {
    console.error('note: --sync is deprecated; use --push (or mice push)')
  }

  const sourceBranch =
    ctx.sourceBranch ||
    (ctx.sourceSpec.includes(':')
      ? ctx.sourceSpec.split(':')[0]
      : ctx.sourceSpec) ||
    ''
  const pinCommit = (
    ctx.pinCommit ||
    (ctx.sourceSpec.includes(':')
      ? ctx.sourceSpec.slice(ctx.sourceSpec.indexOf(':') + 1)
      : ctx.sourceSpec) ||
    ''
  ).toLowerCase()
  const sourceRef =
    sourceBranch && pinCommit
      ? `${sourceBranch}:${pinCommit}`
      : ctx.sourceSpec

  const jobId = randomBytes(8).toString('hex')
  const createdAt = new Date().toISOString()

  const prev = listLocalJobs(ctx.root, {
    namespace: ctx.namespace,
    repo: ctx.repo,
  }).find((j) => j.status === 'succeeded' && j.result_commit)
  const head = headCommit(ctx.root)
  const parent_job_id =
    prev &&
    (commitsEqual(prev.result_commit, pinCommit) ||
      commitsEqual(prev.result_commit, head))
      ? prev.id
      : null

  const local = {
    id: jobId,
    name: flags.name ? String(flags.name) : '',
    status: 'running',
    namespace: ctx.namespace,
    repo: ctx.repo,
    source_ref: sourceRef,
    source_branch: sourceBranch,
    pin_commit: pinCommit,
    result_commit: null,
    result_branch: null,
    sync_branch: '',
    published: false,
    ...(flags.__meta ? { meta: flags.__meta } : {}),
    parent_job_id,
    image,
    command: [command[0]],
    args: command.slice(1),
    created_at: createdAt,
    started_at: createdAt,
    workdir_rel: ctx.workdirRel,
    runner: 'cli',
    timeout_seconds: flags.timeout ? Number(flags.timeout) : 3600,
    resources: {
      cpu: flags.cpu ? String(flags.cpu) : '1',
      memory: flags.memory ? String(flags.memory) : '512m',
    },
  }
  writeLocalJob(ctx.root, local)

  const jobPath = ensureJobDir(ctx.root, jobId)
  const workDir = join(jobPath, 'work')
  const logPath = join(jobPath, 'job.log')

  console.error(
    `running ${jobId} (local, ~/.mice cache) source=${sourceRef}`,
  )

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
      jobId,
      image,
      command: local.command,
      args: local.args,
      workDir,
      workdir: '/data',
      cpu: local.resources.cpu,
      memory: local.resources.memory,
      timeoutSeconds: local.timeout_seconds,
      maxLogBytes: 2_000_000,
      logPath,
    })
    exitCode = result.exitCode
    changed = result.changed
    imageDigest = result.imageDigest
    // Without readwatch: treat pre-job files mentioned in the command as inputs
    // (avoids claiming every repo file, e.g. README.md, as a dependency).
    inputs = pathHashesFromSnapshot(
      inferCommandInputPaths(result.before, local.command, local.args),
      result.before,
    )
    outputs = pathHashesFromSnapshot(changed, result.after)

    if (exitCode === 0 && changed.length) {
      applyOutputsToClone(ctx.root, workDir, changed)
      const ident = ensureOxenIdentity(ctx.root, {})
      if (!ident.ok) {
        throw new Error(ident.detail)
      }
      const oxenOpts = { oxenConfigDir: ident.oxenConfigDir }
      oxenAdd(ctx.root, changed, oxenOpts)
      resultCommit = oxenCommit(
        ctx.root,
        `mice-job ${jobId} (pin ${pinCommit.slice(0, 12)})`,
        oxenOpts,
      )
    } else if (exitCode === 0) {
      resultCommit = pinCommit
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

  const status = exitCode === 0 ? 'succeeded' : 'failed'
  const resultBranch = exitCode === 0 && changed.length ? sourceBranch : null
  const finishedAt = new Date().toISOString()

  local.status = status
  local.result_commit = resultCommit
  local.result_branch = resultBranch
  local.exit_code = exitCode
  local.error = completeError
  local.inputs = inputs
  local.outputs = outputs
  local.image_digest = imageDigest
  local.finished_at = finishedAt
  writeLocalJob(ctx.root, local)

  let pushExtra = {}
  if (wantPush && status === 'succeeded' && resultCommit) {
    const branch = sourceBranch || currentBranch(ctx.root)
    try {
      oxenPush(ctx.root, 'origin', branch || undefined)
      const pub = await publishJobsAfterPush({
        root: ctx.root,
        remote,
        token,
        branch,
      })
      pushExtra = {
        push_ok: pub.ok,
        push_branch: pub.branch,
        published_job_ids: pub.published,
        publish_message: pub.message || pub.skipped || null,
      }
      if (!pub.ok) {
        console.error(`push succeeded but job publish failed: ${pub.message}`)
      } else if (pub.published?.length) {
        console.error(pub.message)
      }
    } catch (err) {
      pushExtra = {
        push_ok: false,
        push_message: err instanceof Error ? err.message : String(err),
      }
      console.error(pushExtra.push_message)
    }
  } else if (status === 'succeeded') {
    console.error(
      'local only — job appears on the remote/UI after: mice push',
    )
  }

  console.log(
    JSON.stringify(
      jobSummary(
        {
          ...local,
          runner: 'cli',
        },
        pushExtra,
      ),
      null,
      2,
    ),
  )
  if (status !== 'succeeded') process.exit(1)
  if (wantPush && pushExtra.push_ok === false) process.exit(1)
}

/**
 * Reset stuck/failed job state:
 * - remove disposable work/
 * - mark BFF job failed if still running/queued
 * - mark local job failed (or --purge delete metadata)
 * - restore dirty worktree to HEAD so the next run can start
 *
 * Requires confirmation when job metadata would be changed/removed or the
 * worktree restored (unless --yes).
 */
async function cmdReset(flags) {
  const root = findOxenRoot(process.cwd())
  if (!root) {
    console.error('mice job reset must be run inside an oxen clone')
    process.exit(1)
  }
  // Soft auth: only needed if a published/remote job must be marked failed.
  const remote = resolveRemote({
    remote: flags.remote ? String(flags.remote) : undefined,
  })
  const token = String(flags.token || resolveToken() || '')

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

  const dirty = isWorktreeClean(root)
  const idList = targets.map((j) => j.id).join(', ')
  const actions = [
    purge
      ? `DELETE local job metadata for: ${idList}`
      : `mark job(s) failed and keep metadata for: ${idList}`,
  ]
  if (!dirty.clean) {
    actions.push(
      'restore dirty worktree to HEAD (discards uncommitted changes)',
    )
  }
  await confirmOrExit(
    `Destructive job reset:\n  - ${actions.join('\n  - ')}`,
    flags,
  )

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

const MICE_VERSION = '0.1.0'

function parseLoginFlags(argv) {
  /** @type {{ remote?: string, open: boolean, scopes: object[] }} */
  const opts = { open: true, scopes: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remote' && argv[i + 1]) {
      opts.remote = argv[++i]
    } else if (a.startsWith('--remote=')) {
      opts.remote = a.slice('--remote='.length)
    } else if ((a === '--scope' && argv[i + 1]) || a.startsWith('--scope=')) {
      const text = a === '--scope' ? argv[++i] : a.slice('--scope='.length)
      const scope = parseScope(text)
      if (!scope) {
        console.error(`Invalid --scope "${text}". Use <namespace>[/<repo>]:<read|triage|write|maintain|admin>`)
        process.exit(1)
      }
      opts.scopes.push(scope)
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
  let jobMeta = null
  let jobRest = jobArgv.slice(1)
  if (cmd === 'run') {
    try {
      const ex = extractCreateMeta(jobRest)
      jobMeta = ex.patch
      jobRest = ex.args
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
      usage(1)
    }
  }
  const { flags, _: rest } = parseArgs(jobRest)
  flags.__meta = jobMeta

  if (cmd === 'run') {
    await cmdRun(flags, rest)
    return
  }

  if (cmd === 'sync') {
    console.error(
      'mice job sync is removed. Push commits with `mice push` — job metadata is published automatically.',
    )
    process.exit(1)
  }

  if (cmd === 'reset') {
    await cmdReset(flags)
    return
  }

  if (cmd === 'list') {
    if (flags.published || flags.all) {
      const { remote, token } = resolveAuth(flags)
      const root = findOxenRoot()
      const detected = root ? detectRemote(root) : null
      const q = new URLSearchParams()
      // --all lists across repos; otherwise scope to the clone / flags.
      const namespace = flags.namespace ? String(flags.namespace) : flags.all ? '' : detected?.namespace
      const repo = flags.repo ? String(flags.repo) : flags.all ? '' : detected?.repo
      if (namespace) q.set('namespace', namespace)
      if (repo) q.set('repo', repo)
      for (const k of ['status', 'limit', 'cursor']) if (flags[k]) q.set(k, String(flags[k]))
      if (flags.pin) q.set('pin_commit', String(flags.pin))
      const data = await api(remote, token, `/auth/jobs?${q}`)
      console.log(JSON.stringify(data, null, 2))
      return
    }
    const root = findOxenRoot()
    const detected = root ? detectRemote(root) : null
    const namespace = flags.namespace
      ? String(flags.namespace)
      : detected?.namespace
    const repo = flags.repo ? String(flags.repo) : detected?.repo
    if (!root) {
      console.error('mice job list must be run inside an oxen clone')
      usage(1)
    }
    if (!namespace || !repo) {
      console.error('Need --namespace and --repo (or run inside a clone)')
      usage(1)
    }
    const rows = listLocalJobs(root, { namespace, repo })
      .filter((j) => !flags.status || j.status === String(flags.status))
      .map((j) => ({
        id: j.id,
        status: j.status,
        source_ref: j.source_ref,
        sync_branch: j.sync_branch || null,
        published: !!j.published || !!j.sync_branch,
        result_branch: j.result_branch || null,
        result_commit: j.result_commit || null,
        command: [...(j.command || []), ...(j.args || [])].join(' '),
      }))
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  if (cmd === 'status') {
    const id = requireFlag(flags, 'id', usage)
    const root = findOxenRoot()
    if (root) {
      const local = readLocalJob(root, id)
      if (local) {
        console.log(JSON.stringify(local, null, 2))
        return
      }
    }
    const { remote, token } = resolveAuth(flags)
    const data = await api(remote, token, `/auth/jobs/${encodeURIComponent(id)}`)
    console.log(JSON.stringify(data.job, null, 2))
    return
  }

  if (cmd === 'logs') {
    const id = requireFlag(flags, 'id', usage)
    const root = findOxenRoot()
    if (root) {
      const text = readLocalJobLog(root, id)
      if (text) {
        process.stdout.write(text)
        if (!text.endsWith('\n')) process.stdout.write('\n')
        return
      }
    }
    const { remote, token } = resolveAuth(flags)
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
    const root = findOxenRoot()
    if (root) {
      const local = readLocalJob(root, id)
      if (local && !local.published && !local.sync_branch) {
        writeLocalJob(root, {
          ...local,
          status: 'cancelled',
          error: local.error || 'cancelled locally',
          finished_at: new Date().toISOString(),
        })
        console.log(JSON.stringify(readLocalJob(root, id), null, 2))
        return
      }
    }
    const { remote, token } = resolveAuth(flags)
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
    console.log(`mice ${MICE_VERSION}`)
    const ov = oxenVersion()
    if (ov) console.log(`oxen ${ov}`)
    else console.log('oxen: not found on PATH')
    return
  }

  if (cmd === 'job') {
    await cmdJob(argv.slice(1))
    return
  }

  if (ADMIN_GROUPS.includes(cmd)) {
    await runAdmin(cmd, argv.slice(1), {
      auth: resolveAuth,
      usage,
      ctx: (flags) => {
        const root = findOxenRoot(process.cwd())
        const detected = root ? detectRemote(root) : null
        return {
          namespace: String(flags.namespace || detected?.namespace || '') || undefined,
          repo: String(flags.repo || detected?.repo || '') || undefined,
        }
      },
    })
    return
  }

  if (cmd === 'meta') {
    await cmdMeta(argv.slice(1), {
      auth: resolveAuth,
      usage,
      ctx: (flags) => {
        const root = findOxenRoot(process.cwd())
        const detected = root ? detectRemote(root) : null
        const namespace = String(flags.namespace || detected?.namespace || '')
        const repo = String(flags.repo || detected?.repo || '')
        if (!namespace) {
          throw new Error('Could not detect namespace; run inside a clone or pass --namespace/--repo')
        }
        return {
          namespace,
          repo,
          branch: root ? currentBranch(root) : undefined,
        }
      },
    })
    return
  }

  // --- Oxen passthrough ---
  const remote = resolveRemote()
  if (looksLikeDirectOxenServer(remote)) {
    console.error(
      `mice: MICE_REMOTE / configured remote looks like raw oxen-server (${remote}).\nUse the auth BFF remote (e.g. http://localhost:8080), not :3001.`,
    )
    process.exitCode = 1
    return
  }

  try {
    ensureOxenAuth(remote)
  } catch (err) {
    console.error(`mice: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  let passArgv = argv
  let createMeta = null
  let creation = null
  try {
    const ex = extractCreateMeta(argv)
    creation = ex.patch ? detectCreation(ex.args) : null
    // Other commands keep their own --tag/--label semantics untouched.
    if (creation) {
      createMeta = ex.patch
      passArgv = ex.args
    }
  } catch (err) {
    console.error(`mice: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  const { args, rewritten, blocked } = rewriteArgsForBff(passArgv, remote)
  if (blocked) {
    console.error(`mice: could not rewrite direct oxen-server URL: ${blocked}`)
    process.exitCode = 1
    return
  }
  if (rewritten) {
    console.error(`mice: rewrote :3001 remote URL(s) to ${remote}`)
  }

  const code = await runOxenPassthrough(args)
  process.exitCode = code

  if (code === 0 && createMeta && creation) {
    const root = findOxenRoot(process.cwd())
    const detected = root ? detectRemote(root) : null
    const token = resolveToken()
    let type = creation.kind
    let id = ''
    if (creation.kind === 'repo') {
      id = creation.name
    } else if (detected?.namespace && detected?.repo) {
      const base = `${detected.namespace}/${detected.repo}`
      if (creation.kind === 'branch') id = `${base}@${creation.name}`
      else if (root && headCommit(root)) id = `${base}#${headCommit(root)}`
    }
    if (!id || !token) {
      console.error(
        `mice: could not set metadata automatically; run: mice meta set ${type} <id> …`,
      )
      process.exitCode = 1
    } else if (!(await applyCreateMeta({ remote, token, type, id, patch: createMeta }))) {
      process.exitCode = 1
    }
  }

  // After a successful push through the BFF, publish local job metadata
  // for result commits that are now on the pushed tip.
  if (code === 0 && args[0] === 'push') {
    const root = findOxenRoot(process.cwd())
    if (root) {
      const { branch } = parsePushRef(args)
      const token = resolveToken()
      if (token) {
        const pub = await publishJobsAfterPush({
          root,
          remote,
          token,
          branch: branch || currentBranch(root),
        })
        if (!pub.ok) {
          console.error(
            `mice: commits pushed, but job publish failed: ${pub.message}`,
          )
          process.exitCode = 1
        } else if (pub.published?.length) {
          console.error(`mice: ${pub.message}`)
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
