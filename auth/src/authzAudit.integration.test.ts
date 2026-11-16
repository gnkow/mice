import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { preparePrincipal } = await import('./authz.js')
const { writeInstancePermissions } = await import('./authzInstanceStore.js')

const app = createApp()
const stranger = iso.person('authz-audit-http-deny')
await preparePrincipal(stranger)
await writeInstancePermissions(stranger, [])

describe('audit routes AuthZ (HTTP)', () => {
  it('answers 403 when the caller cannot read audit', async () => {
    const res = await app.request('/auth/audit?limit=5', {
      headers: await iso.sessionHeaders(stranger),
    })
    assert.equal(res.status, 403)
    const body = (await res.json()) as { error?: string }
    assert.match(body.error ?? '', /view_audit|Forbidden|audit/i)
  })
})
