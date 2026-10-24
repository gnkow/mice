import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertProductionStartup, productionStartupProblems } from './startupGate.js'

const good = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a-private-secret',
  OIDC_CLIENT_SECRET: 'real-secret',
  COOKIE_SECURE: 'true',
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
})
