import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

let idTokenClaims: Record<string, unknown> = {}
const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }

const idp: Server = createServer((req, res) => {
  const base = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`
  res.setHeader('content-type', 'application/json')
  if (req.url?.endsWith('/.well-known/openid-configuration')) {
    res.end(
      JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/auth`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
      }),
    )
    return
  }
  if (req.url === '/jwks') {
    res.end(JSON.stringify({ keys: [jwk] }))
    return
  }
  req.resume()
  req.on('end', () => {
    void new SignJWT(idTokenClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .sign(privateKey)
      .then((idToken) => res.end(JSON.stringify({ id_token: idToken })))
  })
})
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
const issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`

process.env.OIDC_ISSUER = issuer
process.env.OIDC_CLIENT_ID = 'mice-web'
process.env.OIDC_REDIRECT_URI = 'http://localhost/auth/callback'
process.env.SESSION_SECRET = 'test-session-secret-for-login'

const { startLogin, completeLogin, safeReturnPath } = await import('./loginFlow.js')

const now = () => Math.floor(Date.now() / 1000)
const claimsFor = (nonce: string) => ({
  iss: issuer,
  aud: 'mice-web',
  exp: now() + 300,
  nonce,
  sub: 'u1',
  email: 'u1@example.com',
  email_verified: true,
  preferred_username: 'u1',
  auth_time: now(),
})

describe('login flow: startLogin / completeLogin', () => {
  after(() => idp.close())

  it('drops an unsafe next path', async () => {
    assert.equal(safeReturnPath('//evil.example'), undefined)
    assert.equal(safeReturnPath('/auth/logout'), undefined)
    assert.equal(safeReturnPath('/jobs'), '/jobs')
  })

  it('rejects a state mismatch, a missing cookie and an IdP error with 400', async () => {
    const start = await startLogin()
    const bad = await completeLogin({ code: 'c', state: 'other', pkceCookie: start.pkceCookie })
    assert.deepEqual([bad.ok, !bad.ok && bad.status], [false, 400])
    const missing = await completeLogin({ code: 'c', state: 's', pkceCookie: undefined })
    assert.deepEqual([missing.ok, !missing.ok && missing.status], [false, 400])
    const denied = await completeLogin({ error: 'access_denied', pkceCookie: start.pkceCookie })
    assert.deepEqual([denied.ok, !denied.ok && denied.status], [false, 400])
  })

  it('maps an id_token failure to 500 with the reason', async () => {
    const start = await startLogin()
    const state = new URL(start.authorizeUrl).searchParams.get('state')!
    idTokenClaims = claimsFor('wrong-nonce')
    const r = await completeLogin({ code: 'c', state, pkceCookie: start.pkceCookie })
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.status, 500)
    assert.match(r.html, /nonce/)
  })
})
