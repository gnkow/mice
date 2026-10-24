import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { isAuthzEnforce } from './authzStore.js'
import { assertProductionStartup, productionStartupProblems } from './startupGate.js'

const good = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a-private-secret',
  OIDC_CLIENT_SECRET: 'real-secret',
  COOKIE_SECURE: 'true',
  OIDC_ISSUER: 'https://idp.example.com/realms/mice',
  AUTHZ_BOOTSTRAP_ADMINS: 'admin@example.com',
  AUTH_DATA_DIR: mkdtempSync(join(tmpdir(), 'mice-gate-')),
}

describe('production startup gate', () => {
  it('accepts a hardened production env', () => {
    assert.deepEqual(productionStartupProblems(good), [])
  })

  it('rejects the dev SESSION_SECRET and a missing one', () => {
    for (const SESSION_SECRET of ['dev-only-change-me-mice-session-secret', undefined]) {
      const p = productionStartupProblems({ ...good, SESSION_SECRET })
      assert.equal(p.length, 1)
      assert.match(p[0], /SESSION_SECRET/)
    }
  })

  it('rejects the shipped OIDC client secret', () => {
    const p = productionStartupProblems({ ...good, OIDC_CLIENT_SECRET: 'mice-auth-secret' })
    assert.match(p[0], /mice-auth-secret/)
  })

  it('rejects non-Secure cookies', () => {
    const p = productionStartupProblems({ ...good, COOKIE_SECURE: undefined })
    assert.match(p[0], /COOKIE_SECURE/)
  })

  it('rejects a non-https issuer in production only', () => {
    const p = productionStartupProblems({ ...good, OIDC_ISSUER: 'http://idp.example.com' })
    assert.equal(p.length, 1)
    assert.match(p[0], /OIDC_ISSUER/)
    assert.deepEqual(
      productionStartupProblems({ NODE_ENV: 'development', OIDC_ISSUER: 'http://keycloak:8080' }),
      [],
    )
  })

  it('refuses GXP_STRICT with the idle timeout off', () => {
    for (const SESSION_IDLE_SEC of [undefined, '0']) {
      const p = productionStartupProblems({ GXP_STRICT: 'true', SESSION_IDLE_SEC })
      assert.equal(p.length, 1)
      assert.match(p[0], /SESSION_IDLE_SEC/)
    }
  })

  it('starts GXP_STRICT with a positive idle timeout, and non-strict with none', () => {
    assert.deepEqual(productionStartupProblems({ GXP_STRICT: 'true', SESSION_IDLE_SEC: '900' }), [])
    assert.deepEqual(productionStartupProblems({ SESSION_IDLE_SEC: '0' }), [])
  })

  it('rejects production with AuthZ enforcement forced off', () => {
    const p = productionStartupProblems({ ...good, AUTHZ_ENFORCE: 'false' })
    assert.equal(p.length, 1)
    assert.match(p[0], /AUTHZ_ENFORCE/)
  })

  it('accepts AuthZ enforcement unset or true in production', () => {
    for (const AUTHZ_ENFORCE of [undefined, '', 'true']) {
      assert.deepEqual(productionStartupProblems({ ...good, AUTHZ_ENFORCE }), [])
    }
  })

  it('rejects production without a bootstrap admin', () => {
    for (const AUTHZ_BOOTSTRAP_ADMINS of [undefined, '', ' , ']) {
      const p = productionStartupProblems({ ...good, AUTHZ_BOOTSTRAP_ADMINS })
      assert.equal(p.length, 1)
      assert.match(p[0], /AUTHZ_BOOTSTRAP_ADMINS/)
    }
  })

  it('rejects dev grant-all and dev mode in production only', () => {
    const grant = productionStartupProblems({ ...good, AUTHZ_DEV_GRANT_ALL: 'true' })
    assert.equal(grant.length, 1)
    assert.match(grant[0], /AUTHZ_DEV_GRANT_ALL/)
    const dev = productionStartupProblems({ ...good, AUTH_DEV_MODE: 'true' })
    assert.equal(dev.length, 1)
    assert.match(dev[0], /AUTH_DEV_MODE/)
    assert.deepEqual(
      productionStartupProblems({ NODE_ENV: 'development', AUTHZ_DEV_GRANT_ALL: 'true' }),
      [],
    )
  })

  it('rejects an unwritable data directory in production', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-gate-ro-'))
    chmodSync(dir, 0o500)
    const p = productionStartupProblems({ ...good, AUTH_DATA_DIR: dir })
    chmodSync(dir, 0o700)
    if (process.getuid?.() === 0) return
    assert.equal(p.length, 1)
    assert.match(p[0], /AUTH_DATA_DIR/)
  })

  it('requires an internal oxen upstream in production', () => {
    for (const OXEN_UPSTREAM of [
      undefined,
      'http://oxen-server:3001',
      'http://127.0.0.1:3001',
      'http://localhost:3001',
      'http://10.1.2.3:3001',
      'http://192.168.0.5:3001',
      'http://172.20.0.2:3001',
      'http://oxen.mice.svc.cluster.local:3001',
      'http://oxen.internal:3001',
    ]) {
      assert.deepEqual(productionStartupProblems({ ...good, OXEN_UPSTREAM }), [], String(OXEN_UPSTREAM))
    }
    for (const OXEN_UPSTREAM of [
      'http://oxen.example.com:3001',
      'https://8.8.8.8',
      'http://203.0.113.9:3001',
      'not a url',
    ]) {
      const p = productionStartupProblems({ ...good, OXEN_UPSTREAM })
      assert.equal(p.length, 1, OXEN_UPSTREAM)
      assert.match(p[0], /OXEN_UPSTREAM/)
    }
    assert.deepEqual(
      productionStartupProblems({ NODE_ENV: 'development', OXEN_UPSTREAM: 'http://oxen.example.com' }),
      [],
    )
  })

  it('throws with every problem listed', () => {
    assert.throws(
      () => assertProductionStartup({ NODE_ENV: 'production' }),
      /SESSION_SECRET[\s\S]*COOKIE_SECURE/,
    )
  })

  it('does nothing outside production', () => {
    assert.doesNotThrow(() => assertProductionStartup({}))
    assert.doesNotThrow(() => assertProductionStartup({ NODE_ENV: 'development' }))
  })

  it('keeps AuthZ enforcement on in production regardless of env or store', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      assert.equal(isAuthzEnforce(), true)
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })
})
