import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePatScopes } from './patScopes.js'

describe('parsePatScopes', () => {
  it('accepts namespace, optional repo and a known max role', () => {
    const r = parsePatScopes([{ namespace: 'lab', repo: 'data', maxRole: 'read' }, { namespace: 'ops', maxRole: 'write' }])
    assert.deepEqual(r, {
      ok: true,
      scopes: [{ namespace: 'lab', repo: 'data', maxRole: 'read' }, { namespace: 'ops', maxRole: 'write' }],
    })
  })

  it('treats missing or empty input as no scopes', () => {
    assert.deepEqual(parsePatScopes(undefined), { ok: true, scopes: undefined })
    assert.deepEqual(parsePatScopes([]), { ok: true, scopes: undefined })
  })

  it('rejects unknown roles, bad names and non-arrays', () => {
    for (const bad of [
      [{ namespace: 'a', maxRole: 'owner' }],
      [{ namespace: '', maxRole: 'read' }],
      [{ namespace: 'a/b', maxRole: 'read' }],
      [{ namespace: 'a', repo: '../x', maxRole: 'read' }],
      [{ maxRole: 'read' }],
      'nope',
    ]) {
      assert.equal(parsePatScopes(bad).ok, false, JSON.stringify(bad))
    }
  })
})
