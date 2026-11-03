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
process.env.SESSION_SECRET = 'test-session-secret-for-oidc'

const { exchangeCode } = await import('./oidc.js')
const { ID_TOKEN_LEEWAY_SEC } = await import('./oidcClaims.js')

const now = () => Math.floor(Date.now() / 1000)
const claims = (over: Record<string, unknown> = {}) => ({
  iss: issuer,
  aud: 'mice-web',
  exp: now() + 300,
  nonce: 'n1',
  sub: 'u1',
  email: 'u1@example.com',
  email_verified: true,
  preferred_username: 'u1',
  auth_time: now() - 3,
  ...over,
})
const login = (over?: Record<string, unknown>, nonce = 'n1') => {
  idTokenClaims = claims(over)
  return exchangeCode({ code: 'c', codeVerifier: 'v', nonce })
}

describe('login: exchangeCode against a stub IdP', () => {
  after(() => idp.close())

  it('returns the identity with verified email and auth_time', async () => {
    const u = await login()
    assert.equal(u.sub, 'u1')
    assert.equal(u.iss, issuer)
    assert.equal(u.emailVerified, true)
    assert.equal(typeof u.authTime, 'number')
  })

  it('treats a missing or false email_verified as unverified', async () => {
    assert.equal((await login({ email_verified: undefined })).emailVerified, false)
    assert.equal((await login({ email_verified: false })).emailVerified, false)
    assert.equal((await login({ email_verified: 'true' })).emailVerified, false)
  })

  it('falls back to the synthetic address, unverified, when there is no email', async () => {
    const u = await login({ email: undefined, email_verified: true })
    assert.equal(u.email, 'u1@users.local')
    assert.equal(u.emailVerified, false)
  })

  it('rejects wrong audience, wrong issuer, expiry and nonce', async () => {
    await assert.rejects(login({ aud: 'other' }), /audience/)
    await assert.rejects(login({ iss: 'https://evil.example' }), /issuer/)
    await assert.rejects(login({ exp: now() - ID_TOKEN_LEEWAY_SEC - 1 }), /expired/)
    await assert.rejects(login({}, 'replayed'), /nonce/)
  })

  it('tolerates a missing auth_time', async () => {
    const u = await login({ auth_time: undefined })
    assert.equal(u.authTime, undefined)
  })
})
