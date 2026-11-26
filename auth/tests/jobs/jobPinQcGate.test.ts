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
const { queryAudit } = await import('../../src/packages/audit/lib/audit.js')

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

const failedPin = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const okPin = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('Job pin bind refuses QC Failed', () => {
  it('publishSyncedCliJobs returns 409 and audits when pin is QC Failed', async () => {
    await markCommitsQc(repo.id, [failedPin], 'failed')

    const result = await publishSyncedCliJobs(
      admin,
      'session',
      [
        {
          id: 'abcdef0123456789',
          namespace: 'pin-job',
          repo: 'data',
          source_ref: `main:${failedPin}`,
          pin_commit: failedPin,
          image: 'alpine:3.20',
          command: ['true'],
          status: 'succeeded',
        },
      ],
      'mice/cli-sync',
    )
    assert.ok('error' in result)
    assert.equal(result.status, 409)
    assert.match(result.error, /QC Failed/i)

    const { events } = await queryAudit({ action: 'request.rejected', limit: 20 })
    assert.ok(
      events.some(
        (e) =>
          e.detail &&
          typeof e.detail === 'object' &&
          (e.detail as { pin_commit?: string }).pin_commit === failedPin,
      ),
      'expected pin refusal audit',
    )
  })

  it('publishSyncedCliJobs allows a non-failed pin', async () => {
    await markCommitsQc(repo.id, [okPin], 'passed')
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
