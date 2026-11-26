import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('../src/app.js')
const { appendAudit } = await import('../src/packages/audit/lib/audit.js')

const signer = iso.person('sig-signer')
const evidence = { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 }
const verification = { jwks_key_id: 'kid-1', token_verified_at: 1_767_225_600_000, idp_issuer: 'https://idp.test' }
await appendAudit({
  actor: { iss: signer.iss, sub: signer.sub, email: signer.email, name: signer.name },
  via: 'session',
  method: 'POST',
  path: '/auth/admin/seal-keys/rotate',
  status: 200,
  action: 'seal_key.rotated',
  signature_id: 'sig-h1',
  detail: {
    signatureId: 'sig-h1',
    meaning: 'Approved',
    hash: 'h1',
    signedAt: 't',
    newKeyId: 'key-1',
    mfaEvidence: evidence,
    verificationMetadata: verification,
  },
})

const auditor = iso.person('sig-auditor')
await iso.grantRole(auditor, 'auditor')
const jwt = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')
const query = async (idToken?: string) =>
  createApp().request('/auth/audit?action=seal_key.rotated', {
    headers: await iso.sessionHeaders({ ...auditor, ...(idToken ? { idToken } : {}) } as typeof auditor),
  })

describe('Auditor opens signature evidence (#13)', () => {
  it('returns the stored MFA and verification evidence on the mutation row', async () => {
    const res = await query(jwt({ acr: 'mfa', amr: ['pwd', 'otp'] }))
    assert.equal(res.status, 200)
    const body = (await res.json()) as { events: { action?: string; detail?: Record<string, unknown> }[] }
    const hit = body.events.find((e) => e.detail?.hash === 'h1')
    assert.ok(hit, `expected seal_key.rotated with hash h1; got ${JSON.stringify(body.events.slice(0, 5))}`)
    assert.deepEqual(hit.detail?.mfaEvidence, evidence)
    assert.deepEqual(hit.detail?.verificationMetadata, verification)
  })

  it('refuses audit reads from an Auditor session without MFA evidence', async () => {
    assert.equal((await query()).status, 403)
    assert.equal((await query(jwt({ acr: 'password', amr: ['pwd'] }))).status, 403)
  })
})
