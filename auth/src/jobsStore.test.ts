import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JobRun } from './jobsTypes.js'
import { breakTable } from './db/testDatabase.js'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
const { appendJob, getJob, listJobs, rekeyJob, resolveJobId, upsertJob } = await import('./jobsStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
await createNamespaceAuthz(t.person('jobs-owner'), 'ns', 'none')

const OLD = 'aaaaaaaaaaaaaaaa'
const NEW = 'bbbbbbbbbbbbbbbb'

const job = (id: string): JobRun => ({
  id, name: 'n', status: 'succeeded', namespace: 'ns', repo: 'r', source_ref: 'main:c', pin_commit: 'c',
  target_branch: '', sync_branch: '', result_commit: null, result_branch: null, image: 'img', image_digest: null,
  command: [], args: [], env: {}, workdir: '/data', input_globs: [], timeout_seconds: 1,
  resources: { cpu: '1', memory: '1g', disk: '1g' }, max_log_bytes: 1, network: 'none',
  actor: { sub: 'u', iss: 'i', email: 'e', name: 'n' }, via: 'session', inputs: [], outputs: [],
  created_at: '2026-01-01T00:00:00.000Z', started_at: null, finished_at: null, exit_code: 0, error: null,
  log_ref: null, source: 'commit_clone', runtime_id: null, runner: 'docker',
} as JobRun)

const ids = async () => (((await listJobs({})).jobs.map((j) => j.id)).sort())

await describe('jobs store', async () => {
  await it('appends, upserts and reads a job', async () => {
    await appendJob(job('cccccccccccccccc'))
    await upsertJob({ ...job('cccccccccccccccc'), name: 'renamed' })
    assert.equal((await getJob('cccccccccccccccc'))?.name, 'renamed')
    assert.ok(((await ids()).includes('cccccccccccccccc')))
  })
})

await describe('listing jobs by a field', async () => {
  await it('returns only jobs matching the status filter', async () => {
    await appendJob({ ...job('dddddddddddddddd'), status: 'queued' })
    assert.deepEqual((await listJobs({ status: 'queued' })).jobs.map((j) => j.id), ['dddddddddddddddd'])
  })
})

await describe('rekeyJob', async () => {
  await it('moves state, alias and log together and reports the log rename', async () => {
    await upsertJob(job(OLD))
    const moves: string[][] = []
    const result = await rekeyJob(OLD, job(NEW), { exists: () => true, rename: (a, b) => void moves.push([a, b]) })
    assert.deepEqual(result, { logRenamed: true })
    assert.equal(await resolveJobId(OLD), NEW)
    assert.equal((await getJob(OLD))?.id, NEW)
    assert.deepEqual(((await ids()).filter((i) => i === OLD || i === NEW)), [NEW])
    assert.equal(moves.length, 1)
    assert.match(moves[0]![0]!, new RegExp(`${OLD}\\.log$`))
    assert.match(moves[0]![1]!, new RegExp(`${NEW}\\.log$`))
  })

  await it('repoints aliases that already targeted the old id', async () => {
    const a = 'dddddddddddddddd', b = 'eeeeeeeeeeeeeeee', c = 'ffffffffffffffff'
    await upsertJob(job(a))
    await rekeyJob(a, job(b), { exists: () => false, rename() {} })
    await rekeyJob(b, job(c), { exists: () => false, rename() {} })
    assert.equal(await resolveJobId(a), c)
    assert.equal(await resolveJobId(b), c)
  })

  await it('a failed log rename is not fatal: state and alias stay consistent', async () => {
    const o = '1111111111111111', n = '2222222222222222'
    await upsertJob(job(o))
    const result = await rekeyJob(o, job(n), { exists: () => true, rename() { throw new Error('EXDEV') } })
    assert.deepEqual(result, { logRenamed: false })
    assert.equal((await getJob(o))?.id, n)
  })

  await it('a failed alias write rolls back: the old job stays authoritative', async () => {
    const o = '3333333333333333', n = '4444444444444444'
    await upsertJob(job(o))
    const repair = await breakTable('job_aliases')
    try {
      await assert.rejects(rekeyJob(o, job(n), { exists: () => true, rename() { assert.fail('log must not move') } }))
    } finally {
      await repair()
    }
    assert.equal(await resolveJobId(o), o)
    assert.equal((await getJob(o))?.id, o)
    assert.equal(await getJob(n), null)
    assert.ok(!((await ids()).includes(n)))
  })

  await it('same id is a plain upsert', async () => {
    const o = '5555555555555555'
    await upsertJob(job(o))
    assert.deepEqual(await rekeyJob(o, { ...job(o), name: 'x' }), { logRenamed: false })
    assert.equal((await getJob(o))?.name, 'x')
  })
})
