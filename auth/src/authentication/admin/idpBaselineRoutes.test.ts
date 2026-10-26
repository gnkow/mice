import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-baseline-'))
process.env.SESSION_SECRET = 'test-session-secret-for-baseline'

const { Hono } = await import('hono')
const { registerIdpBaselineRoutes } = await import('./idpBaselineRoutes.js')
const { sealSession } = await import('../session/session.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { env } = await import('../../env.js')
const { auditMutation } = await import('../../auditMutation.js')

const mk = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@test.io`,
  name: sub,
  sessionStart: Math.floor(Date.now() / 1000) - 30,
  emailVerified: true,
})

// Bootstrap admin
await maybeBootstrapInstanceAdmin(mk('admin'))

describe('IdP Baseline Check Routes', () => {
  let app: ReturnType<typeof Hono>

  beforeEach(async () => {
    app = new Hono()
    registerIdpBaselineRoutes(app, { audit: auditMutation })
  })

  it('registers POST /auth/admin/idp-baseline/check endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/check', {
      method: 'POST',
    })

    // Should return 401 (unauthenticated) not 404 (not found)
    assert.equal(response.status, 401)
  })

  it('registers GET /auth/admin/idp-baseline/status endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/status', {
      method: 'GET',
    })

    // Should return 401 (unauthenticated) not 404 (not found)
    assert.equal(response.status, 401)
  })

  it('registers GET /auth/admin/idp-baseline/history endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/history', {
      method: 'GET',
    })

    // Should return 401 (unauthenticated) not 404 (not found)
    assert.equal(response.status, 401)
  })
})

