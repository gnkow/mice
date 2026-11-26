import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { auditResourceUri } from '../../src/packages/audit/lib/auditResourceUri.js'

describe('auditResourceUri', () => {
  it('prefers job for job.* and batch job_ids', () => {
    assert.equal(
      auditResourceUri({ action: 'job.publish', detail: { job_ids: ['j1', 'j2'] } }),
      'job:j1',
    )
    assert.equal(
      auditResourceUri({ action: 'job.complete', namespace: 'n', repo: 'r', detail: { job_id: 'j9' } }),
      'job:j9',
    )
  })

  it('prefers session for session.* even when mounts list workspaces', () => {
    assert.equal(
      auditResourceUri({
        action: 'session.create',
        detail: {
          session_id: 's1',
          mounts: [{ namespace: 'n', repo: 'r', workspace_id: 'w1' }],
        },
      }),
      'session:s1',
    )
  })

  it('forms workspace URI with ns/repo for workspace.*', () => {
    assert.equal(
      auditResourceUri({
        action: 'workspace.lease.acquire',
        namespace: 'n',
        repo: 'r',
        detail: { session_id: 's1', workspace_id: 'w1' },
      }),
      'workspace:n/r!w1',
    )
  })

  it('falls through to repo, namespace, then action', () => {
    assert.equal(auditResourceUri({ action: 'file.write', namespace: 'n', repo: 'r' }), 'repo:n/r')
    assert.equal(auditResourceUri({ action: 'namespace.create', namespace: 'n' }), 'namespace:n')
    assert.equal(auditResourceUri({ action: 'audit.browse' }), 'action:audit.browse')
  })

  it('always returns a non-empty string', () => {
    assert.ok(auditResourceUri({ action: '' }).startsWith('action:'))
  })
})
