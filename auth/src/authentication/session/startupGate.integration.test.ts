/**
 * Package-seam integration for Tickets 33 and 51.
 * Exercises idle / absolute lifetime refusal through the authentication package
 * exports (`productionStartupProblems` → `assertProductionStartup`).
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const { assertProductionStartup, productionStartupProblems } = await import('../index.js')

const good = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a-private-secret',
  OIDC_CLIENT_SECRET: 'real-secret',
  COOKIE_SECURE: 'true',
  OIDC_ISSUER: 'https://idp.example.com/realms/mice',
  AUTHZ_BOOTSTRAP_ADMINS: 'admin@example.com',
  AUTH_DATA_DIR: mkdtempSync(join(tmpdir(), 'mice-gate-integ-')),
  SESSION_IDLE_SEC: '900',
  IMMUDB_HA: 'true',
  BACKUP_TARGET: mkdtempSync(join(tmpdir(), 'mice-backup-integ-')),
}

describe('Ticket 33 — idle timeout package seam', () => {
  it('productionStartupProblems refuses unset, zero, or negative idle', () => {
    for (const SESSION_IDLE_SEC of [undefined, '0', '-1']) {
      const p = productionStartupProblems({ ...good, SESSION_IDLE_SEC })
      assert.equal(p.length, 1, String(SESSION_IDLE_SEC))
      assert.match(p[0]!, /SESSION_IDLE_SEC/)
    }
  })

  it('assertProductionStartup throws when idle is zero', () => {
    assert.throws(
      () => assertProductionStartup({ ...good, SESSION_IDLE_SEC: '0' }),
      /Refusing to start[\s\S]*SESSION_IDLE_SEC must be greater than 0/,
    )
  })

  it('assertProductionStartup accepts a positive idle within the ceiling', () => {
    assert.doesNotThrow(() => assertProductionStartup(good))
  })
})

describe('Ticket 51 — absolute lifetime package seam', () => {
  it('productionStartupProblems refuses an absolute lifetime above 8 hours', () => {
    const p = productionStartupProblems({ ...good, SESSION_TTL_SEC: '28801' })
    assert.equal(p.length, 1)
    assert.match(p[0]!, /SESSION_TTL_SEC/)
  })

  it('assertProductionStartup throws when absolute lifetime exceeds the ceiling', () => {
    assert.throws(
      () => assertProductionStartup({ ...good, SESSION_TTL_SEC: '28801' }),
      /Refusing to start[\s\S]*SESSION_TTL_SEC/,
    )
  })

  it('assertProductionStartup accepts unset SESSION_TTL_SEC (8 h default)', () => {
    assert.doesNotThrow(() => assertProductionStartup({ ...good }))
  })
})
