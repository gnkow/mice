import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-jobs-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.JOBS_DATA_DIR = join(dataDir, 'jobs')
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'

const {
  parseSubmitBody,
  publicJob,
  branchFromSourceRef,
  publishSyncedCliJobs,
} = await import('./jobs.js')
const { parseSourceSpec } = await import('./jobsSource.js')
const { matchGlobs, toDockerHostPath, resolveReadWatchBin } = await import(
  './jobsRunner.js'
)
const { mergeRangePath } = await import('./jobsOxen.js')
const { getJob, rekeyJob, resolveJobId, upsertJob } = await import(
  './jobsStore.js'
)
const { env } = await import('./env.js')
const { queryAudit } = await import('./audit.js')
const { validateArity, appendLineage, queryLineage } = await import(
  './lineage.js'
)
const {
  authorizeJobCancel,
  authorizeJobComplete,
  authorizeJobSubmit,
  authorizeJobRead,
  preparePrincipal,
} = await import('./authz.js')
const {
  createNamespaceAuthz,
  setRepoCollaborator,
  setAuthzEnforce,
} = await import('./authzStore.js')
const { createCustomRepoRole } = await import('./customRoles.js')

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  name: 'Admin',
}

before(() => {
  setAuthzEnforce(true)
  preparePrincipal(admin)
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('parseSubmitBody', () => {
  it('rejects stage sources', () => {
    const base = { namespace: 'n', repo: 'r', image: 'x', command: 'y' }
    for (const extra of [
      { source: 'workspace_mount' },
      { source_kind: 'workspace_mount' },
      { workspace_id: 'w1' },
    ]) {
      const r = parseSubmitBody({ ...base, ...extra })
      assert.ok('error' in r)
      assert.equal(r.error, 'stage sources are no longer supported')
    }
  })

  it('publicJob drops legacy workspace_id', () => {
    const legacy = {
      id: 'x', name: '', status: 'succeeded', namespace: 'n', repo: 'r',
      source_ref: 'main:p', pin_commit: 'p', target_branch: '', sync_branch: '',
      image: 'i', command: 'c', args: [], env: {}, workdir: '/data',
      input_globs: [], timeout_seconds: 1, max_log_bytes: 1,
      resources: { cpu: '1', memory: '1', disk: '1' },
      actor: { sub: 's' }, via: 'session', inputs: [], outputs: [],
      created_at: '', started_at: null, finished_at: null, exit_code: 0,
      error: null, log_ref: '', source: 'workspace_mount', workspace_id: 'w1',
      runtime_id: null,
    } as never
    const pub = publicJob(legacy) as unknown as Record<string, unknown>
    assert.equal('workspace_id' in pub, false)
  })

  it('requires core fields', () => {
    const r = parseSubmitBody({})
    assert.ok('error' in r)
  })

  it('parses source ref and resources', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      name: 'letter-count',
      source: 'main:0123456789abcdef0123456789abcdef',
      target: 'develop',
      image: 'alpine:3.20',
      command: ['touch', '/data/x'],
      timeout_seconds: 30,
      resources: { cpu: '2', memory: '1g' },
    })
    assert.ok(!('error' in r))
    assert.equal(r.name, 'letter-count')
    assert.equal(r.source, 'main:0123456789abcdef0123456789abcdef')
    assert.equal(r.target, 'develop')
    assert.equal(r.source_kind, 'commit_clone')
    assert.equal(r.timeout_seconds, 30)
    assert.equal(r.resources?.cpu, '2')
  })

  it('allows omit target (no merge)', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      source: 'main',
      image: 'alpine:3.20',
      command: ['true'],
    })
    assert.ok(!('error' in r))
    assert.equal(r.target, undefined)
    assert.equal(r.branch, undefined)
  })

  it('parses runner: cli', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      source: 'main',
      image: 'alpine:3.20',
      command: ['true'],
      runner: 'cli',
    })
    assert.ok(!('error' in r))
    assert.equal(r.runner, 'cli')
  })

  it('does not treat legacy branch as merge target', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      pin_commit: '0123456789abcdef0123456789abcdef',
      branch: 'main',
      image: 'alpine:3.20',
      command: ['true'],
    })
    assert.ok(!('error' in r))
    assert.equal(r.branch, 'main')
    assert.equal(r.target, undefined)
  })
})

describe('mergeRangePath', () => {
  it('keeps slashes in job branch names (web baseHead)', () => {
    assert.equal(
      mergeRangePath('main', 'mice/job/abc123'),
      'main..mice/job/abc123',
    )
  })
})

describe('branchFromSourceRef', () => {
  it('extracts branch before colon', () => {
    assert.equal(
      branchFromSourceRef('main:0123456789abcdef0123456789abcdef'),
      'main',
    )
    assert.equal(branchFromSourceRef(''), '')
  })
})

describe('parseSourceSpec', () => {
  it('parses branch:commit, branch, and commit', () => {
    const bc = parseSourceSpec('main:0123456789abcdef0123456789abcdef')
    assert.ok(!('error' in bc))
    assert.equal(bc.kind, 'branch_commit')
    const b = parseSourceSpec('main')
    assert.ok(!('error' in b))
    assert.equal(b.kind, 'branch')
    const c = parseSourceSpec('0123456789abcdef0123456789abcdef')
    assert.ok(!('error' in c))
    assert.equal(c.kind, 'commit')
  })
})

describe('matchGlobs', () => {
  it('filters paths', () => {
    const paths = ['a.txt', 'datasets/x.csv', 'other/y.csv']
    assert.deepEqual(matchGlobs(paths, ['datasets/**']), ['datasets/x.csv'])
  })
})

describe('resolveReadWatchBin', () => {
  it('finds committed linux prebuild or system watcher when present', () => {
    const bin = resolveReadWatchBin()
    // On macOS unit tests the linux binary exists on disk but is not executable
    // here; resolution only checks existsSync.
    if (bin) {
      assert.match(bin, /mice-readwatch|inotifywait/)
    }
  })
})

describe('diffTrees', () => {
  it('only reports real content changes when hashes use the same scheme', async () => {
    const { diffTrees } = await import('./jobsOxen.js')
    const before = new Map([
      ['README.md', 'aaa'],
      ['data.csv', 'bbb'],
    ])
    const after = new Map([
      ['README.md', 'aaa'],
      ['data.csv', 'bbb'],
      ['out.txt', 'ccc'],
    ])
    const d = diffTrees(before, after)
    assert.deepEqual(d.added, ['out.txt'])
    assert.deepEqual(d.modified, [])
    assert.deepEqual(d.removed, [])
  })
})

describe('toDockerHostPath', () => {
  it('rewrites JOBS_DATA_DIR prefix to JOBS_HOST_DATA_DIR', () => {
    const prevHost = env.jobsHostDataDir
    const prevData = env.jobsDataDir
    ;(env as { jobsHostDataDir: string }).jobsHostDataDir =
      '/Users/me/mice/.data/jobs'
    ;(env as { jobsDataDir: string }).jobsDataDir = '/data/jobs'
    assert.equal(
      toDockerHostPath('/data/jobs/work/abc/data'),
      '/Users/me/mice/.data/jobs/work/abc/data',
    )
    assert.equal(toDockerHostPath('/data/jobs'), '/Users/me/mice/.data/jobs')
    assert.equal(toDockerHostPath('/tmp/other'), '/tmp/other')
    ;(env as { jobsHostDataDir: string }).jobsHostDataDir = prevHost
    ;(env as { jobsDataDir: string }).jobsDataDir = prevData
  })
})

describe('lineage job kind', () => {
  it('allows empty I/O', () => {
    assert.equal(validateArity('job', [], []), null)
  })

  it('stores and queries by jobId', () => {
    appendLineage({
      kind: 'job',
      namespace: 'ns',
      repo: 'r',
      inputs: [],
      outputs: [],
      source: 'explicit',
      confidence: 'high',
      detail: { job_id: 'job1', pin_commit: 'p1' },
    })
    const { operations } = queryLineage({
      namespace: 'ns',
      repo: 'r',
      kind: 'job',
      jobId: 'job1',
    })
    assert.ok(operations.some((o) => o.detail?.job_id === 'job1'))
  })
})

describe('job authz', () => {
  it('submit requires write; read requires read', () => {
    const ns = 'job-acl'
    const reader = {
      sub: 'reader',
      iss: 'test',
      email: 'reader@example.com',
      name: 'Reader',
    }
    const writer = {
      sub: 'writer',
      iss: 'test',
      email: 'writer@example.com',
      name: 'Writer',
    }
    createNamespaceAuthz(admin, ns, 'none', true)
    setRepoCollaborator(ns, 'r1', reader, 'read')
    setRepoCollaborator(ns, 'r1', writer, 'write')

    assert.equal(authorizeJobRead(reader, ns, 'r1').allow, true)
    assert.equal(authorizeJobSubmit(reader, ns, 'r1').allow, false)
    assert.equal(authorizeJobSubmit(writer, ns, 'r1').allow, true)
    assert.equal(authorizeJobRead(writer, ns, 'r1').allow, true)
    assert.equal(authorizeJobCancel(writer, ns, 'r1').allow, true)
    assert.equal(authorizeJobComplete(writer, ns, 'r1').allow, true)
    assert.equal(authorizeJobCancel(reader, ns, 'r1').allow, false)
  })

  it('custom role can grant job_complete without job_submit', () => {
    const ns = 'job-atomic'
    const user = {
      sub: 'completer',
      iss: 'test',
      email: 'completer@example.com',
      name: 'Completer',
    }
    createNamespaceAuthz(admin, ns, 'none', true)
    const role = createCustomRepoRole(ns, {
      name: 'Complete only',
      base: 'read',
      permissions: ['job_complete'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    setRepoCollaborator(ns, 'r1', user, role.role.id)
    setAuthzEnforce(true)
    assert.equal(authorizeJobComplete(user, ns, 'r1').allow, true)
    assert.equal(authorizeJobSubmit(user, ns, 'r1').allow, false)
  })
})

describe('publicJob', () => {
  it('redacts secret-shaped env', () => {
    const redacted = publicJob({
      id: 'x',
      name: '',
      status: 'queued',
      namespace: 'n',
      repo: 'r',
      source_ref: 'main:p',
      pin_commit: 'p',
      target_branch: 'main',
      sync_branch: '',
      result_commit: null,
      result_branch: null,
      image: 'alpine',
      image_digest: null,
      command: ['true'],
      args: [],
      env: { EPOCHS: '3', API_TOKEN: 'secret' },
      workdir: '/data',
      input_globs: [],
      timeout_seconds: 60,
      resources: { cpu: '1', memory: '1g', disk: '1g' },
      max_log_bytes: 1000,
      network: 'none',
      actor: { sub: 'u', iss: 'i', email: 'e', name: 'n' },
      via: 'session',
      inputs: [],
      outputs: [],
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      exit_code: null,
      error: null,
      log_ref: null,
      source: 'commit_clone',
      runtime_id: null,
      runner: 'docker',
    })
    assert.equal(redacted.env.EPOCHS, '3')
    assert.equal(redacted.env.API_TOKEN, '***')
  })
})

describe('job id rekey', () => {
  it('local runs resolve provisional id to result commit id', () => {
    const provisional = 'abcdabcdabcdabcd'
    const commit = '0123456789abcdef0123456789abcdef'
    const base = {
      id: provisional,
      name: '',
      status: 'succeeded' as const,
      namespace: 'n',
      repo: 'r',
      source_ref: 'main:p',
      pin_commit: 'p',
      target_branch: '',
      sync_branch: '',
      result_commit: commit,
      result_branch: `mice/job/${commit}`,
      image: 'alpine',
      image_digest: null,
      command: ['true'],
      args: [],
      env: {},
      workdir: '/data',
      input_globs: [],
      timeout_seconds: 60,
      resources: { cpu: '1', memory: '1g', disk: '1g' },
      max_log_bytes: 1000,
      network: 'none',
      actor: { sub: 'u', iss: 'i', email: 'e', name: 'n' },
      via: 'session' as const,
      inputs: [],
      outputs: [],
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: new Date().toISOString(),
      exit_code: 0,
      error: null,
      log_ref: null,
      source: 'commit_clone' as const,
      runtime_id: null,
      runner: 'docker' as const,
    }
    upsertJob({ ...base, id: provisional, result_commit: null })
    rekeyJob(provisional, { ...base, id: commit })
    assert.equal(resolveJobId(provisional), commit)
    assert.equal(getJob(provisional)?.id, commit)
    assert.equal(getJob(commit)?.id, commit)
    assert.equal(getJob(commit)?.result_commit, commit)
  })
})

describe('publishSyncedCliJobs', () => {
  it('creates terminal CLI jobs and sets sync_branch', () => {
    const pin = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const published = publishSyncedCliJobs(
      admin,
      'pat',
      [
        {
          id: 'a1b2c3d4e5f67890',
          namespace: 'pubns',
          repo: 'pubrepo',
          name: 'demo',
          source_ref: `main:${pin}`,
          pin_commit: pin,
          image: 'alpine:3.20',
          command: ['sh', '-c'],
          args: ['echo hi'],
          status: 'succeeded',
          exit_code: 0,
          result_commit: result,
          result_branch: 'main',
          log_text: 'hello from local\n',
        },
      ],
      'main',
    )
    assert.ok(!('error' in published), 'error' in published ? published.error : '')
    assert.equal(published.jobs.length, 1)
    const job = getJob('a1b2c3d4e5f67890')
    assert.ok(job)
    assert.equal(job.runner, 'cli')
    assert.equal(job.status, 'succeeded')
    assert.equal(job.sync_branch, 'main')
    assert.equal(job.result_commit, result)
    const outcomes = queryAudit({ action: 'job.complete', jobId: job.id }).events
    assert.equal(outcomes.length, 1)
    assert.deepEqual(outcomes[0].detail?.owner, { sub: admin.sub, iss: admin.iss })
    const repeated = publishSyncedCliJobs(
      admin,
      'pat',
      [{ ...job, status: 'succeeded' }],
      'main',
    )
    assert.ok(!('error' in repeated))
    assert.equal(queryAudit({ action: 'job.complete', jobId: job.id }).events.length, 1)
  })

  it('rejects path-traversal job ids', () => {
    const bad = publishSyncedCliJobs(
      admin,
      'pat',
      [
        {
          id: '../../../../tmp/evil',
          namespace: 'pubns',
          repo: 'pubrepo',
          source_ref: 'main:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pin_commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          image: 'alpine:3.20',
          command: ['true'],
          status: 'succeeded',
        },
      ],
      'main',
    )
    assert.ok('error' in bad)
    assert.match(bad.error, /invalid job id/i)
  })
})
