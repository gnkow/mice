import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideIdpAccessGate } from './idpAccessGate'

describe('decideIdpAccessGate', () => {
  it('maps 503 to an IdP unavailable alert', () => {
    const gate = decideIdpAccessGate(503, 'Service Unavailable - IdP check failed')
    assert.equal(gate?.kind, 'unavailable')
    assert.equal(gate?.status, 503)
    assert.equal(gate?.tone, 'warn')
    assert.match(gate?.title ?? '', /Identity provider/i)
    assert.match(gate?.message ?? '', /IdP check failed|identity provider/i)
  })

  it('maps 403 to an access refused alert', () => {
    const gate = decideIdpAccessGate(403, 'Suspended')
    assert.equal(gate?.kind, 'refused')
    assert.equal(gate?.status, 403)
    assert.equal(gate?.tone, 'error')
    assert.equal(gate?.message, 'Suspended')
  })

  it('returns null for other statuses', () => {
    assert.equal(decideIdpAccessGate(401), null)
    assert.equal(decideIdpAccessGate(200), null)
  })
})
