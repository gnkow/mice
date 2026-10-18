import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  boxenHome,
  jobsDir,
  listLocalJobs,
  readLocalJob,
  repoJobsKey,
  writeLocalJob,
} from './localStore.mjs'

describe('localStore (~/.boxen cache)', () => {
  /** @type {string} */
  let home
  /** @type {string} */
  let root
  /** @type {string | undefined} */
  let prevHome

  before(() => {
    prevHome = process.env.BOXEN_HOME
    home = mkdtempSync(join(tmpdir(), 'boxen-home-'))
    root = mkdtempSync(join(tmpdir(), 'boxen-clone-'))
    process.env.BOXEN_HOME = home
  })

  after(() => {
    if (prevHome === undefined) delete process.env.BOXEN_HOME
    else process.env.BOXEN_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('stores jobs under BOXEN_HOME/jobs/<repoKey>, not in the clone', () => {
    assert.equal(boxenHome(), home)
    const key = repoJobsKey(root)
    assert.match(key, /^[0-9a-f]{16}$/)
    assert.equal(jobsDir(root), join(home, 'jobs', key))
    assert.ok(!jobsDir(root).startsWith(root))
  })

  it('round-trips job.json and lists by namespace/repo', () => {
    writeLocalJob(root, {
      id: 'abc123',
      namespace: 'acme',
      repo: 'data',
      status: 'succeeded',
      created_at: '2026-01-02T00:00:00.000Z',
    })
    writeLocalJob(root, {
      id: 'def456',
      namespace: 'other',
      repo: 'data',
      status: 'failed',
      created_at: '2026-01-01T00:00:00.000Z',
    })

    const job = readLocalJob(root, 'abc123')
    assert.equal(job?.id, 'abc123')
    assert.equal(job?.clone_root, root)

    const listed = listLocalJobs(root, { namespace: 'acme', repo: 'data' })
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, 'abc123')
  })
})
