import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectJobBranches,
  filterAndSortJobs,
  jobCommandLabel,
  jobImageLabel,
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerKind,
  jobRunnerLabel,
  jobSourceBranch,
  jobTargetBranch,
  parseJobListSort,
  parseJobRunner,
  parseJobStatus,
  shortenJobRef,
  type JobRun,
} from './jobs.ts'

function job(partial: Partial<JobRun> & Pick<JobRun, 'id'>): JobRun {
  return {
    name: '',
    status: 'succeeded',
    namespace: 'ns',
    repo: 'repo',
    source_ref: 'main:abc',
    pin_commit: 'abc',
    target_branch: '',
    sync_branch: 'main',
    result_commit: null,
    result_branch: null,
    image: 'alpine:3.20',
    image_digest: null,
    command: ['echo'],
    args: ['hi'],
    env: {},
    workdir: '/data',
    input_globs: [],
    timeout_seconds: 3600,
    resources: { cpu: '1', memory: '512m', disk: '' },
    max_log_bytes: 1_000_000,
    network: 'none',
    actor: { sub: 'u', iss: 'i', email: 'a@b.c', name: 'Ann' },
    via: 'session',
    inputs: [],
    outputs: [],
    created_at: '2026-01-02T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    exit_code: 0,
    error: null,
    log_ref: null,
    source: 'commit_clone',
    workspace_id: null,
    runner: 'cli',
    ...partial,
  }
}

describe('job runner labels', () => {
  it('maps cli → Local and docker/kubernetes → Cluster', () => {
    assert.equal(jobRunnerKind({ runner: 'cli' }), 'local')
    assert.equal(jobRunnerKind({ runner: 'docker' }), 'cluster')
    assert.equal(jobRunnerKind({ runner: 'kubernetes' }), 'cluster')
    // Missing / unknown → Cluster (server-side)
    assert.equal(jobRunnerKind({ runner: null }), 'cluster')
    assert.equal(jobRunnerKind({}), 'cluster')

    assert.equal(jobRunnerLabel({ runner: 'cli' }), 'Local')
    assert.equal(jobRunnerLabel({ runner: 'docker' }), 'Cluster')
    assert.equal(jobRunnerLabel({ runner: 'kubernetes' }), 'Cluster')
    assert.equal(jobRunnerDetail({ runner: 'cli' }), 'Local (CLI)')
    assert.equal(jobRunnerDetail({ runner: 'docker' }), 'Cluster (Docker)')
    assert.equal(
      jobRunnerDetail({ runner: 'kubernetes' }),
      'Cluster (Kubernetes)',
    )
    assert.equal(jobRunnerClass({ runner: 'cli' }), 'pill runner-local')
    assert.equal(jobRunnerClass({ runner: 'docker' }), 'pill runner-cluster')
    assert.equal(
      jobRunnerClass({ runner: 'kubernetes' }),
      'pill runner-cluster',
    )
  })
})

describe('job list display helpers', () => {
  it('shortens branch:commit refs for list UI', () => {
    assert.equal(
      shortenJobRef('main:e301e0781e65e175c7d97b808caff79f'),
      'main:e301e078',
    )
    assert.equal(shortenJobRef('local'), 'local')
    assert.equal(shortenJobRef('—'), '—')
    assert.equal(
      shortenJobRef('e301e0781e65e175c7d97b808caff79f'),
      'e301e078',
    )
  })

  it('truncates image and command labels', () => {
    assert.equal(jobImageLabel({ image: 'alpine:3.20' }), 'alpine:3.20')
    assert.equal(
      jobCommandLabel({ command: ['sh', '-c'], args: ['echo hi'] }),
      'sh -c echo hi',
    )
    const longCmd = jobCommandLabel({
      command: ['python'],
      args: ['-c', 'x'.repeat(80)],
    })
    assert.ok(longCmd.endsWith('…'))
    assert.ok(longCmd.length <= 64)
  })
})

describe('filterAndSortJobs', () => {
  const sample = [
    job({
      id: 'a',
      name: 'alpha',
      status: 'failed',
      runner: 'cli',
      created_at: '2026-01-01T00:00:00.000Z',
      finished_at: '2026-01-01T01:00:00.000Z',
      image: 'alpine:3.20',
      command: ['cp'],
      args: ['in.txt', 'out.txt'],
    }),
    job({
      id: 'b',
      name: 'beta',
      status: 'running',
      runner: 'docker',
      created_at: '2026-01-03T00:00:00.000Z',
      finished_at: null,
      image: 'python:3.12',
      command: ['python'],
      args: ['train.py'],
    }),
    job({
      id: 'c',
      name: '',
      status: 'succeeded',
      runner: 'kubernetes',
      created_at: '2026-01-02T00:00:00.000Z',
      finished_at: '2026-01-02T12:00:00.000Z',
    }),
  ]

  it('parses status, runner, and sort query values', () => {
    assert.equal(parseJobStatus('failed'), 'failed')
    assert.equal(parseJobStatus('nope'), '')
    assert.equal(parseJobRunner('local'), 'local')
    assert.equal(parseJobRunner('cli'), '')
    assert.equal(parseJobListSort('name_asc'), 'name_asc')
    assert.equal(parseJobListSort(''), 'created_desc')
  })

  it('filters by status, runner, and search text', () => {
    assert.deepEqual(
      filterAndSortJobs(sample, { status: 'failed' }).map((j) => j.id),
      ['a'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { runner: 'local' }).map((j) => j.id),
      ['a'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { runner: 'cluster' }).map((j) => j.id),
      ['b', 'c'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { q: 'train.py' }).map((j) => j.id),
      ['b'],
    )
  })

  it('filters by source and target branch', () => {
    const branched = [
      job({
        id: 's1',
        source_ref: 'main:aaa',
        sync_branch: 'main',
        created_at: '2026-01-03T00:00:00.000Z',
      }),
      job({
        id: 's2',
        source_ref: 'feature:bbb',
        sync_branch: 'feature',
        created_at: '2026-01-02T00:00:00.000Z',
      }),
      job({
        id: 's3',
        source_ref: 'main:ccc',
        sync_branch: '',
        target_branch: 'release',
        created_at: '2026-01-01T00:00:00.000Z',
      }),
    ]
    assert.equal(jobSourceBranch(branched[0]!), 'main')
    assert.equal(jobTargetBranch(branched[2]!), 'release')
    assert.deepEqual(collectJobBranches(branched), {
      source: ['feature', 'main'],
      target: ['feature', 'main', 'release'],
    })
    assert.deepEqual(
      filterAndSortJobs(branched, { source_branch: 'main' }).map((j) => j.id),
      ['s1', 's3'],
    )
    assert.deepEqual(
      filterAndSortJobs(branched, { target_branch: 'feature' }).map((j) => j.id),
      ['s2'],
    )
    assert.deepEqual(
      filterAndSortJobs(branched, {
        source_branch: 'main',
        target_branch: 'release',
      }).map((j) => j.id),
      ['s3'],
    )
  })

  it('sorts by created, finished, name, and status', () => {
    assert.deepEqual(
      filterAndSortJobs(sample, { sort: 'created_desc' }).map((j) => j.id),
      ['b', 'c', 'a'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { sort: 'created_asc' }).map((j) => j.id),
      ['a', 'c', 'b'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { sort: 'finished_desc' }).map((j) => j.id),
      ['c', 'a', 'b'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { sort: 'name_asc' }).map((j) => j.id),
      ['a', 'b', 'c'],
    )
    assert.deepEqual(
      filterAndSortJobs(sample, { sort: 'status_asc' }).map((j) => j.id),
      ['b', 'a', 'c'],
    )
  })
})
