import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseScope } from './args.mjs'

describe('parseScope', () => {
  it('parses namespace[/repo]:role', () => {
    assert.deepEqual(parseScope('lab/data:read'), { namespace: 'lab', repo: 'data', maxRole: 'read' })
    assert.deepEqual(parseScope('lab:admin'), { namespace: 'lab', maxRole: 'admin' })
  })

  it('rejects malformed scopes and unknown roles', () => {
    for (const bad of ['lab', 'lab:owner', ':read', 'a/b/c:read', '../x:read']) {
      assert.equal(parseScope(bad), null, bad)
    }
  })
})

describe('parseScope role names', () => {
  it('accepts every contract repo role and nothing else', async () => {
    const { REPO_ROLES } = await import('./authzContract.mjs')
    for (const role of REPO_ROLES) assert.equal(parseScope(`lab:${role}`)?.maxRole, role)
    assert.equal(parseScope('lab:owner'), null)
  })
})
