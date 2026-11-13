import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'admin@mice.local' })
after(() => t.restore())

const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { appendJobResultCommitIntent, completeCliJob } = await import('./jobs.js')
const { getJob, upsertJob } = await import('./jobsStore.js')
const { AUDIT_UNAVAILABLE_MESSAGE, actorFromUser, useAuditLedger } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
type Ledger = Awaited<ReturnType<typeof openLedger>>

const admin = {
  ...t.admin,
  email: 'admin@mice.local',
  emailVerified: true as const,
}
await preparePrincipal(admin)

const realLedger = await openLedger({
  ...immudbConfig(),
  prefix: `esign-joboutage/${randomBytes(4).toString('hex')}/`,
})
useAuditLedger(realLedger)

describe('appendJobResultCommitIntent (module seam)', () => {
  it('writes job.result_commit Intent when the ledger accepts it', async () => {
    useAuditLedger(realLedger)
    const intent = await appendJobResultCommitIntent({
      actor: actorFromUser(admin),
      via: 'session',
      path: '/auth/jobs/j1/complete',
      namespace: 'ns',
      repo: 'r',
      jobId: 'j1',
      resultCommit: 'cccccccccccccccccccccccccccccccc',
    })
    assert.equal(intent.phase, 'intent')
    assert.equal(intent.action, 'job.result_commit')
    assert.equal(intent.detail?.job_id, 'j1')
    assert.equal(intent.detail?.result_commit, 'cccccccccccccccccccccccccccccccc')
  })

  it('throws when the ledger cannot append', async () => {
    const broken: Ledger = {
      ...realLedger,
      append: async () => {
        throw new Error('immudb: simulated outage')
      },
    }
    useAuditLedger(broken)
    try {
      await assert.rejects(
        () =>
          appendJobResultCommitIntent({
            actor: actorFromUser(admin),
            via: 'session',
            path: '/auth/jobs/j1',
            namespace: 'ns',
            repo: 'r',
            jobId: 'j1',
          }),
        /simulated outage/,
      )
    } finally {
      useAuditLedger(realLedger)
    }
  })
})

describe('job complete under audit outage (#97)', () => {
  it('refuses result_commit and leaves no result_commit when Intent cannot be stored', async () => {
    const ns = `jobout-${Date.now().toString(36)}`
    await createNamespaceAuthz(admin, ns, 'none')
    const id = `job-${randomBytes(4).toString('hex')}`
    await upsertJob({
      id,
      name: 'outage-job',
      status: 'running',
      namespace: ns,
      repo: 'r',
      source_ref: 'main:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      pin_commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      target_branch: 'main',
      sync_branch: '',
      result_commit: null,
      result_branch: null,
      image: 'alpine:3.20',
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
      actor: { sub: admin.sub, iss: admin.iss, email: admin.email, name: admin.name },
      via: 'session',
      inputs: [],
      outputs: [],
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      finished_at: null,
      exit_code: null,
      error: null,
      log_ref: null,
      source: 'commit_clone',
      runtime_id: null,
      runner: 'cli',
    })

    const broken: Ledger = {
      ...realLedger,
      append: async () => {
        throw new Error('immudb: simulated outage')
      },
    }
    useAuditLedger(broken)
    try {
      const result = await completeCliJob(admin, 'session', id, {
        status: 'succeeded',
        exit_code: 0,
        result_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        result_branch: 'mice/job/' + id,
      })
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.status, 503)
        assert.equal(result.error, AUDIT_UNAVAILABLE_MESSAGE)
      }
      const live = await getJob(id)
      assert.ok(live)
      assert.equal(live.result_commit, null)
      assert.equal(live.status, 'running')
    } finally {
      useAuditLedger(realLedger)
    }
  })
})
