import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { JobRun } from './jobsTypes.js'
import { useJsonBackend, type JsonBackend } from './jsonStore.js'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { appendJob, getJob, listJobs, rekeyJob, resolveJobId, upsertJob } = await import('./jobsStore.js')

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

const ids = () => listJobs({}).jobs.map((j) => j.id).sort()

describe('jobs store on the memory backend', () => {
  it('appends, upserts and reads a job without touching disk', () => {
    appendJob(job('cccccccccccccccc'))
    upsertJob({ ...job('cccccccccccccccc'), name: 'renamed' })
    assert.equal(getJob('cccccccccccccccc')?.name, 'renamed')
    assert.ok(ids().includes('cccccccccccccccc'))
  })
})

describe('rekeyJob', () => {
  it('moves state, alias and log together and reports the log rename', () => {
    upsertJob(job(OLD))
    const moves: string[][] = []
    const result = rekeyJob(OLD, job(NEW), { exists: () => true, rename: (a, b) => void moves.push([a, b]) })
    assert.deepEqual(result, { logRenamed: true })
    assert.equal(resolveJobId(OLD), NEW)
    assert.equal(getJob(OLD)?.id, NEW)
    assert.deepEqual(ids().filter((i) => i === OLD || i === NEW), [NEW])
    assert.equal(moves.length, 1)
    assert.match(moves[0]![0]!, new RegExp(`${OLD}\\.log$`))
    assert.match(moves[0]![1]!, new RegExp(`${NEW}\\.log$`))
  })

  it('repoints aliases that already targeted the old id', () => {
    const a = 'dddddddddddddddd', b = 'eeeeeeeeeeeeeeee', c = 'ffffffffffffffff'
    upsertJob(job(a))
    rekeyJob(a, job(b), { exists: () => false, rename() {} })
    rekeyJob(b, job(c), { exists: () => false, rename() {} })
    assert.equal(resolveJobId(a), c)
    assert.equal(resolveJobId(b), c)
  })

  it('a failed log rename is not fatal: state and alias stay consistent', () => {
    const o = '1111111111111111', n = '2222222222222222'
    upsertJob(job(o))
    const result = rekeyJob(o, job(n), { exists: () => true, rename() { throw new Error('EXDEV') } })
    assert.deepEqual(result, { logRenamed: false })
    assert.equal(getJob(o)?.id, n)
  })

  it('a failed alias write rolls back: the old job stays authoritative', () => {
    const o = '3333333333333333', n = '4444444444444444'
    upsertJob(job(o))
    const inner: JsonBackend = ctx.backend
    const restore = useJsonBackend({
      read: (p) => inner.read(p),
      write: (p, t) => {
        if (p.endsWith('job-aliases.json')) throw new Error('disk full')
        inner.write(p, t)
      },
      append: (p, t) => inner.append!(p, t),
    })
    try {
      assert.throws(() => rekeyJob(o, job(n), { exists: () => true, rename() { assert.fail('log must not move') } }), /disk full/)
    } finally {
      restore()
    }
    assert.equal(resolveJobId(o), o)
    assert.equal(getJob(o)?.id, o)
    assert.equal(getJob(n), null)
    assert.ok(!ids().includes(n))
  })

  it('same id is a plain upsert', () => {
    const o = '5555555555555555'
    upsertJob(job(o))
    assert.deepEqual(rekeyJob(o, { ...job(o), name: 'x' }), { logRenamed: false })
    assert.equal(getJob(o)?.name, 'x')
  })
})
