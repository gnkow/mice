import './db/testSchema.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { createApp } = await import('./app.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { setSigningJwtVerifierForTests } = await import('./authentication/signing/signingRoutes.js')
const { queryAudit } = await import('./audit.js')

const store = openSignatureStore(await openLedger({ ...immudbConfig(), prefix: `esign-http/${randomBytes(4).toString('hex')}/` }))
useSignatureStore(store)

const nowSec = () => Math.floor(Date.now() / 1000)
const idToken = (claims: object) =>
  [
    Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'kid-1' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    's',
  ].join('.')
setSigningJwtVerifierForTests(async (token) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()))

const alice = { ...iso.person('esign-alice'), name: 'Alice Anders' }
await iso.grantRole(alice, 'user')

const execute = async (person: typeof alice & { idToken?: string; authTime?: number }, content = 'Batch 7 released') => {
  const headers = { ...(await iso.sessionHeaders(person)), 'content-type': 'application/json' }
  const app = createApp()
  const prepared = (await (await app.request('/auth/sign/prepare', { method: 'POST', headers, body: JSON.stringify({ content }) })).json()) as { hash: string }
  return app.request('/auth/sign/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, meaning: 'Approved', expectedHash: prepared.hash }),
  })
}
const auditFor = async (action: string) =>
  (await queryAudit({ action, actor: alice.sub, limit: 50 })).events

describe('POST /auth/sign/execute writes the authoritative record', () => {
  it('stores the signature in the ledger, indexes it and audits esign.created', async () => {
    const claims = { iss: 'https://idp.test', sub: alice.sub, auth_time: nowSec() - 5, acr: 'mfa', amr: ['pwd', 'otp'], sid: 'sess-1' }
    const res = await execute({ ...alice, idToken: idToken(claims), authTime: nowSec() - 5 })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { signature: { id: string; hash: string } }

    const stored = await store.get(body.signature.id)
    assert.equal(stored?.record.signer.name, 'Alice Anders')
    assert.equal(stored?.record.signer.sub, alice.sub)
    assert.equal(stored?.record.meaning, 'Approved')
    assert.equal(stored?.record.contentHash, body.signature.hash)
    assert.equal(stored?.record.verificationMetadata?.idp_session_id, 'sess-1')
    assert.equal((await store.find({ signer: alice })).some((s) => s.id === body.signature.id), true)

    const created = (await auditFor('esign.created')).find((e) => e.detail?.signatureId === body.signature.id)
    assert.ok(created)
  })

  it('writes esign.failed and returns no signature when the record cannot be stored', async () => {
    useSignatureStore({ ...store, record: async () => { throw new Error('ledger unavailable') } })
    try {
      const claims = { iss: 'https://idp.test', sub: alice.sub, auth_time: nowSec() - 5, acr: 'mfa', amr: ['pwd', 'otp'] }
      const res = await execute({ ...alice, idToken: idToken(claims), authTime: nowSec() - 5 }, 'Batch 8 released')
      assert.equal(res.status, 503)
      assert.equal(((await res.json()) as { signature?: unknown }).signature, undefined)
      const failed = (await auditFor('esign.failed')).find((e) => /ledger unavailable/.test(e.message ?? ''))
      assert.ok(failed)
    } finally {
      useSignatureStore(store)
    }
  })
})

describe('signature records are immutable through the API', () => {
  it('exposes no route that edits or deletes a signature', () => {
    const mutating = createApp().routes.filter(
      (r) => /sign/i.test(r.path) && ['PUT', 'PATCH', 'DELETE'].includes(r.method),
    )
    assert.deepEqual(mutating, [])
  })
})

describe('GET /auth/sign/:id retrieves the record and proof', () => {
  it('returns the ledger record and a valid verification proof after execute', async () => {
    const claims = {
      iss: 'https://idp.test',
      sub: alice.sub,
      auth_time: nowSec() - 5,
      acr: 'mfa',
      amr: ['pwd', 'otp'],
    }
    const signed = await execute({ ...alice, idToken: idToken(claims), authTime: nowSec() - 5 }, 'Batch 9 released')
    assert.equal(signed.status, 200)
    const { signature } = (await signed.json()) as { signature: { id: string } }

    const headers = await iso.sessionHeaders({ ...alice, idToken: idToken(claims), authTime: nowSec() - 5 })
    const app = createApp()

    const recordRes = await app.request(`/auth/sign/${signature.id}`, { headers })
    assert.equal(recordRes.status, 200)
    const recordBody = (await recordRes.json()) as {
      id: string
      record: { meaning: string; signer: { sub: string } }
    }
    assert.equal(recordBody.id, signature.id)
    assert.equal(recordBody.record.meaning, 'Approved')
    assert.equal(recordBody.record.signer.sub, alice.sub)

    const proofRes = await app.request(`/auth/sign/${signature.id}/proof`, { headers })
    assert.equal(proofRes.status, 200)
    const proofBody = (await proofRes.json()) as { id: string; proof: { valid: boolean; seq: number } }
    assert.equal(proofBody.id, signature.id)
    assert.equal(proofBody.proof.valid, true)
    assert.ok(proofBody.proof.seq > 0)

    const missing = await app.request('/auth/sign/missing-id/proof', { headers })
    assert.equal(missing.status, 404)
  })
})