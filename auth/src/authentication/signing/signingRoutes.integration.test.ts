import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../testSupport.js'

/**
 * Signing-route integration seams for Deep-API tickets 09, 20, 26.
 */

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { createApp } = await import('../../app.js')
const { immudbConfig, openLedger } = await import('../../auditLedger.js')
const { openSignatureStore, useSignatureStore } = await import('./signatureStore.js')
const { setSigningJwtVerifierForTests } = await import('./signingRoutes.js')
const { queryAudit } = await import('../../audit.js')

const store = openSignatureStore(
  await openLedger({ ...immudbConfig(), prefix: `esign-integ/${randomBytes(4).toString('hex')}/` }),
)
useSignatureStore(store)

const nowSec = () => Math.floor(Date.now() / 1000)
const idToken = (claims: object) =>
  [
    Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'kid-integ' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    's',
  ].join('.')

setSigningJwtVerifierForTests(async (token) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()),
)

const alice = { ...iso.person('integ-alice'), name: 'Integ Alice' }
await iso.grantRole(alice, 'user')

async function sessionJson(
  person: typeof alice & { idToken?: string; authTime?: number; lastActive?: number },
) {
  return {
    ...(await iso.sessionHeaders(person)),
    'content-type': 'application/json',
  }
}

describe('Ticket 09 — step-up at signing routes', () => {
  it('POST /auth/sign/prepare challenges a stale auth_time with reauthUrl max_age=60', async () => {
    const headers = await sessionJson({
      ...alice,
      authTime: nowSec() - 120,
      lastActive: nowSec() - 10,
    })
    const res = await createApp().request('/auth/sign/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Batch ready for release' }),
    })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string; maxAge: number; reauthUrl: string }
    assert.equal(body.error, 'reauthentication_required')
    assert.equal(body.maxAge, 60)
    assert.match(body.reauthUrl, /\/auth\/reauth\?max_age=60/)
    assert.match(body.reauthUrl, /sign%2Fprepare|sign\/prepare/)
  })

  it('POST /auth/sign/prepare proceeds when auth_time is inside the 60s window', async () => {
    const headers = await sessionJson({
      ...alice,
      authTime: nowSec() - 5,
      lastActive: nowSec() - 10,
    })
    const res = await createApp().request('/auth/sign/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Batch ready for release' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { hash: string }
    assert.ok(body.hash)
  })
})

describe('Ticket 20 — idle timeout at signing routes', () => {
  it('POST /auth/sign/prepare refuses an idle Session (load or signing gate)', async () => {
    const headers = await sessionJson({
      ...alice,
      authTime: nowSec() - 5,
      lastActive: nowSec() - 20 * 60,
    })
    const res = await createApp().request('/auth/sign/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Idle refusal content' }),
    })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string; message?: string }
    // loadSession expires idle Sessions before the route; either shape is a signing refusal.
    assert.ok(
      body.error === 'Authentication required' || body.error === 'session_idle',
      `unexpected idle refusal: ${body.error}`,
    )
  })

  it('POST /auth/sign/prepare proceeds when lastActive is inside sessionIdleSec', async () => {
    const headers = await sessionJson({
      ...alice,
      authTime: nowSec() - 5,
      lastActive: nowSec() - 60,
    })
    const res = await createApp().request('/auth/sign/prepare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'Active session content' }),
    })
    assert.equal(res.status, 200)
  })
})

describe('Ticket 26 — signature evidence on execute', () => {
  it('stores acr/amr/auth_time and verification metadata on the record and audit detail', async () => {
    const authTime = nowSec() - 5
    const claims = {
      iss: 'https://idp.test',
      sub: alice.sub,
      auth_time: authTime,
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      sid: 'sess-integ',
      jti: 'jti-integ',
    }
    const headers = await sessionJson({
      ...alice,
      idToken: idToken(claims),
      authTime,
      lastActive: nowSec() - 10,
    })
    const app = createApp()
    const content = 'Evidence batch release'
    const prepared = (await (
      await app.request('/auth/sign/prepare', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      })
    ).json()) as { hash: string }

    const res = await app.request('/auth/sign/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content, meaning: 'Approved', expectedHash: prepared.hash }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      signature: {
        id: string
        mfaEvidence?: { acr?: string; amr: string[]; auth_time?: number }
        verificationMetadata?: {
          jwks_key_id: string
          token_verified_at: number
          idp_issuer: string
        }
      }
    }

    assert.deepEqual(body.signature.mfaEvidence, {
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: authTime,
    })
    assert.equal(body.signature.verificationMetadata?.jwks_key_id, 'kid-integ')
    assert.equal(body.signature.verificationMetadata?.idp_issuer, 'https://idp.test')
    assert.ok(typeof body.signature.verificationMetadata?.token_verified_at === 'number')

    const stored = await store.get(body.signature.id)
    assert.deepEqual(stored?.record.mfaEvidence, body.signature.mfaEvidence)
    assert.equal(stored?.record.verificationMetadata?.jwks_key_id, 'kid-integ')
    assert.equal(stored?.record.verificationMetadata?.idp_issuer, 'https://idp.test')
    assert.equal(stored?.record.verificationMetadata?.idp_session_id, 'sess-integ')

    const created = (await queryAudit({ action: 'esign.created', actor: alice.sub, limit: 50 })).events.find(
      (e) => e.detail?.signatureId === body.signature.id,
    )
    assert.ok(created)
    assert.deepEqual(created.detail?.mfaEvidence, body.signature.mfaEvidence)
    assert.equal(
      (created.detail?.verificationMetadata as { jwks_key_id?: string } | undefined)?.jwks_key_id,
      'kid-integ',
    )
  })
})
