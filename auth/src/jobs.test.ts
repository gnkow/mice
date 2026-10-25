import './db/testSchema.js'
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
const { authorizeRepoAction, preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { setAuthzEnforce } = await import('./authzInstanceStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { createCustomRepoRole } = await import('./customRoles.js')

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}

before(async () => {
  await setAuthzEnforce(true)
  await preparePrincipal(admin)
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

await describe('parseSubmitBody', async () => {
  await it('requires core fields', () => {
    const r = parseSubmitBody({})
    assert.ok('error' in r)
  })

  await it('parses source ref and resources', () => {
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

  await it('allows omit target (no merge)', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      source: 'main',
      image: 'alpine:3.20',
      command: ['true'],
    })
    assert.ok(!('error' in r))
    assert.equal(r.target, undefined)
  })

  await it('parses runner: cli', () => {
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

  await it('requires a source', () => {
    const r = parseSubmitBody({
      namespace: 'ns',
      repo: 'r',
      pin_commit: '0123456789abcdef0123456789abcdef',
      branch: 'main',
      image: 'alpine:3.20',
      command: ['true'],
    })
    assert.ok('error' in r)
  })
})

await describe('mergeRangePath', async () => {
  await it('keeps slashes in job branch names (web baseHead)', () => {
    assert.equal(
      mergeRangePath('main', 'mice/job/abc123'),
      'main..mice/job/abc123',
    )
  })
})

await describe('branchFromSourceRef', async () => {
  await it('extracts branch before colon', () => {
    assert.equal(
      branchFromSourceRef('main:0123456789abcdef0123456789abcdef'),
      'main',
    )
    assert.equal(branchFromSourceRef(''), '')
  })
})

await describe('parseSourceSpec', async () => {
  await it('parses branch:commit, branch, and commit', () => {
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

await describe('matchGlobs', async () => {
  await it('filters paths', () => {
    const paths = ['a.txt', 'datasets/x.csv', 'other/y.csv']
    assert.deepEqual(matchGlobs(paths, ['datasets/**']), ['datasets/x.csv'])
  })
})

await describe('resolveReadWatchBin', async () => {
  await it('finds committed linux prebuild or system watcher when present', () => {
    const bin = resolveReadWatchBin()
    // On macOS unit tests the linux binary exists on disk but is not executable
    // here; resolution only checks existsSync.
    if (bin) {
      assert.match(bin, /mice-readwatch|inotifywait/)
    }
  })
})

await describe('diffTrees', async () => {
  await it('only reports real content changes when hashes use the same scheme', async () => {
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

await describe('toDockerHostPath', async () => {
  await it('rewrites JOBS_DATA_DIR prefix to JOBS_HOST_DATA_DIR', () => {
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

await describe('lineage job kind', async () => {
  await it('allows empty I/O', () => {
    assert.equal(validateArity('job', [], []), null)
  })

  await it('stores and queries by jobId', async () => {
    await appendLineage({
      kind: 'job',
      namespace: 'ns',
      repo: 'r',
      inputs: [],
      outputs: [],
      source: 'explicit',
      confidence: 'high',
      detail: { job_id: 'job1', pin_commit: 'p1' },
    })
    const { operations } = await queryLineage({
      namespace: 'ns',
      repo: 'r',
      kind: 'job',
      jobId: 'job1',
    })
    assert.ok(operations.some((o) => o.detail?.job_id === 'job1'))
  })
})

await describe('job authz', async () => {
  await it('submit requires write; read requires read', async () => {
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
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setRepoCollaborator(ns, 'r1', reader, 'read')
    await setRepoCollaborator(ns, 'r1', writer, 'write')

    assert.equal((await authorizeRepoAction(reader, ns, 'r1', 'job.read')).allow, true)
    assert.equal((await authorizeRepoAction(reader, ns, 'r1', 'job.submit')).allow, false)
    assert.equal((await authorizeRepoAction(writer, ns, 'r1', 'job.submit')).allow, true)
    assert.equal((await authorizeRepoAction(writer, ns, 'r1', 'job.read')).allow, true)
    assert.equal((await authorizeRepoAction(writer, ns, 'r1', 'job.cancel')).allow, true)
    assert.equal((await authorizeRepoAction(writer, ns, 'r1', 'job.complete')).allow, true)
    assert.equal((await authorizeRepoAction(reader, ns, 'r1', 'job.cancel')).allow, false)
  })

  await it('custom role can grant job_complete without job_submit', async () => {
    const ns = 'job-atomic'
    const user = {
      sub: 'completer',
      iss: 'test',
      email: 'completer@example.com',
      name: 'Completer',
    }
    await createNamespaceAuthz(admin, ns, 'none', true)
    const role = await createCustomRepoRole(ns, {
      name: 'Complete only',
      base: 'read',
      permissions: ['job_complete'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    await setRepoCollaborator(ns, 'r1', user, role.role.id)
    await setAuthzEnforce(true)
    assert.equal((await authorizeRepoAction(user, ns, 'r1', 'job.complete')).allow, true)
    assert.equal((await authorizeRepoAction(user, ns, 'r1', 'job.submit')).allow, false)
  })
})

await describe('publicJob', async () => {
  await it('redacts secret-shaped env', () => {
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

await describe('job id rekey', async () => {
  await it('local runs resolve provisional id to result commit id', async () => {
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
    await upsertJob({ ...base, id: provisional, result_commit: null })
    await rekeyJob(provisional, { ...base, id: commit })
    assert.equal(await resolveJobId(provisional), commit)
    assert.equal((await getJob(provisional))?.id, commit)
    assert.equal((await getJob(commit))?.id, commit)
    assert.equal((await getJob(commit))?.result_commit, commit)
  })
})

await describe('publishSyncedCliJobs', async () => {
  await it('creates terminal CLI jobs and sets sync_branch', async () => {
    const pin = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const published = await publishSyncedCliJobs(
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
    const job = await getJob('a1b2c3d4e5f67890')
    assert.ok(job)
    assert.equal(job.runner, 'cli')
    assert.equal(job.status, 'succeeded')
    assert.equal(job.sync_branch, 'main')
    assert.equal(job.result_commit, result)
    const outcomes = (await queryAudit({ action: 'job.complete', jobId: job.id })).events
    assert.equal(outcomes.length, 1)
    assert.deepEqual(outcomes[0].detail?.owner, { sub: admin.sub, iss: admin.iss })
    const repeated = await publishSyncedCliJobs(
      admin,
      'pat',
      [{ ...job, status: 'succeeded' }],
      'main',
    )
    assert.ok(!('error' in repeated))
    assert.equal((await queryAudit({ action: 'job.complete', jobId: job.id })).events.length, 1)
  })

  await it('rejects path-traversal job ids', async () => {
    const bad = await publishSyncedCliJobs(
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
