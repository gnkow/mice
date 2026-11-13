import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { assembleSignatureEvidence, buildSigningSessionInfo } from './signingCeremony.js'
import {
  assessSigningEvidenceCompleteness,
  verifySigningEvidence,
} from './signingEvidence.js'

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
const completePayload = { iss: 'https://idp.test', ...good }
const age = { nowSec: NOW, maxAgeSec: 60 }

describe('assembleSignatureEvidence', () => {
  it('builds ceremony MFA evidence and verification metadata from verified claims', () => {
    const assembled = assembleSignatureEvidence(
      {
        iss: 'https://idp.test',
        acr: 'mfa',
        amr: ['pwd', 'otp'],
        auth_time: NOW - 10,
        sid: 's1',
        jti: 'j1',
      },
      { jwksKeyId: 'k1', verifiedAtMs: NOW * 1000 },
    )
    assert.deepEqual(assembled.mfaEvidence, {
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: NOW - 10,
    })
    assert.deepEqual(assembled.verificationMetadata, {
      jwks_key_id: 'k1',
      token_verified_at: NOW * 1000,
      idp_issuer: 'https://idp.test',
      idp_session_id: 's1',
      token_id: 'j1',
    })
  })

  it('refuses assembly when issuer is missing', () => {
    assert.throws(
      () => assembleSignatureEvidence({ acr: 'mfa', amr: ['pwd', 'otp'] }, { jwksKeyId: 'k1', verifiedAtMs: 1 }),
      /missing iss/,
    )
  })

  it('buildSigningSessionInfo maps assembled evidence into createSignature SessionInfo', () => {
    const assembled = assembleSignatureEvidence(completePayload, {
      jwksKeyId: 'k1',
      verifiedAtMs: NOW * 1000,
    })
    const session = buildSigningSessionInfo(
      { iss: 'https://idp.test', sub: 'alice', name: 'Alice' },
      assembled,
    )
    assert.equal(session.mfaVerified, true)
    assert.equal(session.authenticatedAt, (NOW - 10) * 1000)
    assert.deepEqual(session.mfaEvidence, assembled.mfaEvidence)
    assert.deepEqual(session.verificationMetadata, assembled.verificationMetadata)
  })
})

describe('assessSigningEvidenceCompleteness', () => {
  it('accepts fresh complete claims for assembly', () => {
    assert.deepEqual(assessSigningEvidenceCompleteness(completePayload, age), { ok: true })
  })

  it('refuses missing, stale, or weak claims without defaulting', () => {
    const reason = (payload: Record<string, unknown>) => {
      const r = assessSigningEvidenceCompleteness(payload, age)
      return r.ok === false ? r.reason : null
    }
    const { auth_time: _a, ...noAuthTime } = completePayload
    assert.equal(reason(noAuthTime), 'auth_time_missing')
    assert.equal(reason({ ...completePayload, auth_time: NOW - 61 }), 'auth_time_stale')
    const { acr: _c, ...noAcr } = completePayload
    assert.equal(reason(noAcr), 'acr_missing')
    const { amr: _m, ...noAmr } = completePayload
    assert.equal(reason(noAmr), 'amr_missing')
    assert.equal(reason({ ...completePayload, amr: ['pwd'] }), 'weak_mfa')
  })

  it('pairs with assembleSignatureEvidence only after completeness holds', () => {
    const check = assessSigningEvidenceCompleteness(completePayload, age)
    assert.equal(check.ok, true)
    const assembled = assembleSignatureEvidence(completePayload, {
      jwksKeyId: 'k1',
      verifiedAtMs: NOW * 1000,
    })
    assert.equal(assembled.mfaEvidence.acr, 'mfa')
    assert.equal(assembled.mfaEvidence.auth_time, NOW - 10)
    assert.deepEqual(assembled.mfaEvidence.amr, ['pwd', 'otp'])
  })
})

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
