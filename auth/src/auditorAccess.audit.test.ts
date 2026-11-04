import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
const owner = iso.person('aud-owner')
await preparePrincipal(owner)
await iso.grantRole(owner, 'manager')
await createNamespaceAuthz(owner, 'aud-ns', 'none', true)
const auditor = iso.person('aud-reader')
await iso.grantRole(auditor, 'auditor')
const mfaToken = ['e30', Buffer.from(JSON.stringify({ acr: 'mfa', amr: ['pwd', 'otp'] })).toString('base64url'), 's'].join('.')

describe('Auditor reads are audited (#13)', () => {
  it('records an audit event naming the Auditor for a cross-ACL read', async () => {
    const restore = setUpstreamFetch(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const since = (await ledger.readAll()).reduce((m, r) => Math.max(m, r.seq), 0)
      const res = await createApp().request('/api/repos/aud-ns/data', {
        headers: await iso.sessionHeaders({ ...auditor, idToken: mfaToken } as typeof auditor),
      })
      assert.equal(res.status, 200)
      const rows = (await ledger.readAll())
        .filter((r) => r.seq > since)
        .map((r) => JSON.parse(r.value) as { action: string; actor?: { sub?: string } })
        .filter((r) => r.action === 'acl_bypass_read')
      assert.equal(rows.length, 1)
      assert.equal(rows[0].actor?.sub, 'aud-reader')
    } finally {
      restore()
    }
  })
})
