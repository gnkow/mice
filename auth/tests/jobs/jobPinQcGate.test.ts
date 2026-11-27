import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-job-pin-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.JOBS_DATA_DIR = join(dataDir, 'jobs')
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'admin@mice.local' })
after(() => {
  t.restore()
  rmSync(dataDir, { recursive: true, force: true })
})

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { markCommitsQc } = await import('../../src/packages/merge/lib/commitQcStore.js')
const { publishSyncedCliJobs } = await import('../../src/packages/jobs/lib/jobs.js')

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}
await preparePrincipal(admin)
assert.equal((await createNamespaceAuthz(admin, 'pin-job', 'none')).ok, true)
const repo = await ensureRepository('pin-job', 'data')
assert.ok(repo)

const invalidPin = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const okPin = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('Job pin bind allows Invalid (ADR 0009)', () => {
  it('publishSyncedCliJobs allows a QC Invalid pin', async () => {
    await markCommitsQc(repo.id, [invalidPin], 'invalid')

    const result = await publishSyncedCliJobs(
      admin,
      'session',
      [
        {
          id: 'abcdef0123456789',
          namespace: 'pin-job',
          repo: 'data',
          source_ref: `main:${invalidPin}`,
          pin_commit: invalidPin,
          image: 'alpine:3.20',
          command: ['true'],
          status: 'succeeded',
        },
      ],
      'mice/cli-sync',
    )
    assert.ok(!('error' in result), JSON.stringify(result))
    assert.equal(result.jobs.length, 1)
    assert.equal(result.jobs[0]?.pin_commit, invalidPin)
  })

  it('publishSyncedCliJobs allows a Valid pin', async () => {
    await markCommitsQc(repo.id, [okPin], 'valid')
    const result = await publishSyncedCliJobs(
      admin,
      'session',
      [
        {
          id: 'fedcba9876543210',
          namespace: 'pin-job',
          repo: 'data',
          source_ref: `main:${okPin}`,
          pin_commit: okPin,
          image: 'alpine:3.20',
          command: ['true'],
          status: 'succeeded',
        },
      ],
      'mice/cli-sync',
    )
    assert.ok(!('error' in result))
    assert.equal(result.jobs.length, 1)
    assert.equal(result.jobs[0]?.pin_commit, okPin)
  })
})
