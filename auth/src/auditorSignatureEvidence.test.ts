import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { appendAudit } = await import('./audit.js')

const signer = iso.person('sig-signer')
const evidence = { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 }
const verification = { jwks_key_id: 'kid-1', token_verified_at: 1_767_225_600_000, idp_issuer: 'https://idp.test' }
await appendAudit({
  actor: { iss: signer.iss, sub: signer.sub },
  via: 'session',
  method: 'POST',
  path: '/auth/sign/execute',
  status: 200,
  action: 'signature.created',
  detail: { meaning: 'approve', hash: 'h1', signedAt: 't', mfaEvidence: evidence, verificationMetadata: verification },
})

const auditor = iso.person('sig-auditor')
await iso.grantRole(auditor, 'auditor')
const jwt = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.')
const query = async (idToken?: string) =>
  createApp().request('/auth/audit?action=signature.created', {
    headers: await iso.sessionHeaders({ ...auditor, ...(idToken ? { idToken } : {}) } as typeof auditor),
  })

describe('Auditor opens signature evidence (#13)', () => {
  it('returns the stored MFA and verification evidence on signature events', async () => {
    const res = await query(jwt({ acr: 'mfa', amr: ['pwd', 'otp'] }))
    assert.equal(res.status, 200)
    const { events } = (await res.json()) as { events: { detail?: Record<string, unknown> }[] }
    const detail = events.find((e) => e.detail?.hash === 'h1')?.detail
    assert.deepEqual(detail?.mfaEvidence, evidence)
    assert.deepEqual(detail?.verificationMetadata, verification)
  })

  it('refuses audit reads from an Auditor session without MFA evidence', async () => {
    assert.equal((await query()).status, 403)
    assert.equal((await query(jwt({ acr: 'password', amr: ['pwd'] }))).status, 403)
  })
})
