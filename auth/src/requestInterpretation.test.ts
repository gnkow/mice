import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { interpretRequest } from './requestInterpretation.js'

type Row = {
  method: string
  path: string
  audit: string
  authz: string
  minRole: string
  ns?: string
  repo?: string
}

const ROWS: Row[] = [
  { method: 'GET', path: '/api/repos/n/r', audit: 'other', authz: 'other', minRole: 'read', ns: 'n', repo: 'r' },
  { method: 'POST', path: '/api/repos', audit: 'repo.create', authz: 'repo.create', minRole: 'write' },
  { method: 'PUT', path: '/api/repos/n/r/file/main/a.txt', audit: 'file.write', authz: 'file.write', minRole: 'write', ns: 'n', repo: 'r' },
  { method: 'DELETE', path: '/api/repos/n/r/file/main/a.txt', audit: 'file.delete', authz: 'file.delete', minRole: 'write', ns: 'n', repo: 'r' },
  { method: 'POST', path: '/api/repos/n/r/branches', audit: 'branch.create', authz: 'branch.create', minRole: 'write', ns: 'n', repo: 'r' },
  { method: 'DELETE', path: '/api/repos/n/r/branches/x', audit: 'branch.delete', authz: 'branch.delete', minRole: 'maintain', ns: 'n', repo: 'r' },
  { method: 'POST', path: '/api/repos/n/r/merge', audit: 'merge', authz: 'merge', minRole: 'maintain', ns: 'n', repo: 'r' },
  { method: 'DELETE', path: '/api/repos/n/r', audit: 'repo.delete', authz: 'repo.delete', minRole: 'admin', ns: 'n', repo: 'r' },
  { method: 'PATCH', path: '/api/repos/n/r', audit: 'repo.metadata', authz: 'repo.metadata', minRole: 'admin', ns: 'n', repo: 'r' },
  { method: 'POST', path: '/api/repos/n/r/workspaces/w/commit', audit: 'workspace.commit', authz: 'workspace.commit', minRole: 'write', ns: 'n', repo: 'r' },
  // Push transport: audited as `other`, authorized as a data write.
  { method: 'POST', path: '/api/repos/n/r/commits/upload', audit: 'other', authz: 'push', minRole: 'write', ns: 'n', repo: 'r' },
  { method: 'POST', path: '/api/repos/n/r/commits/abc/complete', audit: 'commit.publish', authz: 'push', minRole: 'write', ns: 'n', repo: 'r' },
  { method: 'QUERY', path: '/api/repos/n/r/versions', audit: 'other', authz: 'versions.query', minRole: 'read', ns: 'n', repo: 'r' },
  // Unknown mutating route: default-deny to admin.
  { method: 'POST', path: '/api/repos/n/r/mystery', audit: 'other', authz: 'other', minRole: 'admin', ns: 'n', repo: 'r' },
]

describe('interpretRequest', () => {
  for (const row of ROWS) {
    it(`${row.method} ${row.path}`, () => {
      const r = interpretRequest(row.method, row.path)
      assert.equal(r.action, row.audit)
      assert.equal(r.authzAction, row.authz)
      assert.equal(r.minRole, row.minRole)
      assert.equal(r.namespace, row.ns)
      assert.equal(r.repo, row.repo)
    })
  }

  it('keeps audit detail for file writes', () => {
    const r = interpretRequest('PUT', '/api/repos/n/r/file/main/dir/a.txt')
    assert.deepEqual(r.detail, { branch: 'main', path: 'dir/a.txt' })
  })

  it('treats GET and HEAD as read regardless of action', () => {
    assert.equal(interpretRequest('HEAD', '/api/repos/n/r/anything').minRole, 'read')
  })
})
