import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { verifySigningEvidence } from './signingEvidence.js'

const { publicKey, privateKey } = await generateKeyPair('RS256')
const NOW = 1_800_000_000

async function token(claims: Record<string, unknown>, kid: string | null = 'k1') {
  return new SignJWT({ iss: 'https://idp.test', ...claims })
    .setProtectedHeader({ alg: 'RS256', ...(kid ? { kid } : {}) })
    .sign(privateKey)
}

const verifyJwt = async (t: string) => (await jwtVerify(t, publicKey, { currentDate: new Date(NOW * 1000) })).payload as Record<string, unknown>
const run = (t: string, maxAgeSec = 60) => verifySigningEvidence(t, { verifyJwt, nowSec: NOW, maxAgeSec })
const good = { auth_time: NOW - 10, acr: 'mfa', amr: ['pwd', 'otp'], sid: 's1', jti: 'j1' }

describe('verifySigningEvidence', () => {
  it('accepts fresh, complete claims and returns full evidence', async () => {
    const r = await run(await token(good))
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.mfaEvidence, { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: NOW - 10 })
    assert.equal(r.verificationMetadata.jwks_key_id, 'k1')
    assert.equal(r.verificationMetadata.idp_issuer, 'https://idp.test')
    assert.equal(r.verificationMetadata.idp_session_id, 's1')
    assert.equal(r.verificationMetadata.token_id, 'j1')
  })

  it('refuses a token that fails verification', async () => {
    const r = await verifySigningEvidence(await token(good), {
      verifyJwt: async () => { throw new Error('bad signature') }, nowSec: NOW, maxAgeSec: 60,
    })
    assert.deepEqual(r, { ok: false, reason: 'unverifiable', detail: 'bad signature' })
  })

  it('refuses a token without kid', async () => {
    const r = await run(await token(good, null))
    assert.equal(r.ok === false && r.reason, 'unverifiable')
  })

  it('refuses a missing auth_time instead of defaulting', async () => {
    const { auth_time: _drop, ...rest } = good
    const r = await run(await token(rest))
    assert.equal(r.ok === false && r.reason, 'auth_time_missing')
  })

  it('refuses a stale auth_time', async () => {
    const r = await run(await token({ ...good, auth_time: NOW - 61 }))
    assert.equal(r.ok === false && r.reason, 'auth_time_stale')
  })

  it('refuses a missing acr', async () => {
    const { acr: _drop, ...rest } = good
    const r = await run(await token(rest))
    assert.equal(r.ok === false && r.reason, 'acr_missing')
  })

  it('refuses a missing amr', async () => {
    const { amr: _drop, ...rest } = good
    const r = await run(await token(rest))
    assert.equal(r.ok === false && r.reason, 'amr_missing')
  })

  it('refuses password-only authentication', async () => {
    const r = await run(await token({ ...good, amr: ['pwd'] }))
    assert.equal(r.ok === false && r.reason, 'weak_mfa')
  })
})
