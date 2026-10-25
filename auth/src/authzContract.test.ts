import './db/testSchema.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ALL_INSTANCE_PERMISSIONS } from './authzTypes.js'
import * as contract from './authzContract.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('authz contract', () => {
  it('server catalog is the contract catalog', () => {
    assert.deepEqual(ALL_INSTANCE_PERMISSIONS, [...contract.INSTANCE_PERMISSIONS])
  })

  it('web copy is byte-identical to the server contract (run scripts/sync-authz-contract.mjs)', () => {
    const src = readFileSync(`${repoRoot}auth/src/authzContract.ts`, 'utf8')
    const web = readFileSync(`${repoRoot}web/src/lib/authzContract.ts`, 'utf8')
    assert.equal(web, src)
  })

  it('cli copy exposes the same names as the server contract', async () => {
    const cli = await import(`${repoRoot}cli/lib/authzContract.mjs`)
    for (const key of [
      'INSTANCE_PERMISSIONS',
      'NAMESPACE_ROLES',
      'REPO_ROLES',
      'NAMESPACE_CAPABILITIES',
      'REPO_FINE_PERMISSIONS',
    ] as const) {
      assert.deepEqual([...cli[key]], [...contract[key]], key)
    }
  })

  it('/auth/me/authz shape parses and rejects malformed input', () => {
    const permissions = Object.fromEntries(contract.INSTANCE_PERMISSIONS.map((p) => [p, true]))
    const ok = {
      enforce: true,
      pending: false,
      instanceAdmin: false,
      permissions,
      instancePermissionCatalog: [...contract.INSTANCE_PERMISSIONS],
      hasAnyGrant: true,
    }
    assert.deepEqual(contract.parseAuthzMe(ok)?.permissions, permissions)
    assert.equal(contract.parseAuthzMe(null), null)
    assert.equal(contract.parseAuthzMe({ ...ok, enforce: 'yes' }), null)
    assert.equal(contract.parseAuthzMe({ ...ok, permissions: { view_audit: true } }), null)
    assert.equal(contract.parseAuthzMe({ ...ok, instancePermissionCatalog: ['bogus'] }), null)
  })
})
