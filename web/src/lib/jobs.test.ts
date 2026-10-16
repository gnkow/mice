import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerKind,
  jobRunnerLabel,
} from './jobs.ts'

describe('job runner labels', () => {
  it('maps docker → Local and kubernetes → Cluster', () => {
    assert.equal(jobRunnerKind({ runner: 'docker' }), 'local')
    assert.equal(jobRunnerKind({ runner: 'kubernetes' }), 'cluster')
    // Missing / unknown → Local (historical docker jobs)
    assert.equal(jobRunnerKind({ runner: null }), 'local')
    assert.equal(jobRunnerKind({}), 'local')

    assert.equal(jobRunnerLabel({ runner: 'docker' }), 'Local')
    assert.equal(jobRunnerLabel({ runner: 'kubernetes' }), 'Cluster')
    assert.equal(jobRunnerDetail({ runner: 'docker' }), 'Local (Docker)')
    assert.equal(jobRunnerDetail({ runner: 'cli' }), 'Local (CLI)')
    assert.equal(jobRunnerKind({ runner: 'cli' }), 'local')
    assert.equal(
      jobRunnerDetail({ runner: 'kubernetes' }),
      'Cluster (Kubernetes)',
    )
    assert.equal(jobRunnerClass({ runner: 'docker' }), 'pill runner-local')
    assert.equal(
      jobRunnerClass({ runner: 'kubernetes' }),
      'pill runner-cluster',
    )
  })
})
