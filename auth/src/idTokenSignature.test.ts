import './db/testSchema.js'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'

let idToken = ''
let jwks: JWK[] = []
let jwksDown = false
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

const idp: Server = createServer((req, res) => {
  const base = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`
  res.setHeader('content-type', 'application/json')
  if (req.url?.endsWith('/.well-known/openid-configuration')) {
    res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/auth`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
    }))
    return
  }
  if (req.url === '/jwks') {
    if (jwksDown) { res.statusCode = 503; res.end('{}'); return }
    res.end(JSON.stringify({ keys: jwks }))
    return
  }
  req.resume()
  req.on('end', () => res.end(JSON.stringify({ id_token: idToken })))
})
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
const issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`

process.env.OIDC_ISSUER = issuer
process.env.OIDC_CLIENT_ID = 'mice-web'
process.env.OIDC_REDIRECT_URI = 'http://localhost/auth/callback'
process.env.SESSION_SECRET = 'test-session-secret-for-sig'
process.env.OIDC_VERIFY_ID_TOKEN = 'true'
process.env.OIDC_JWKS_COOLDOWN_MS = '0'

const { startLogin, completeLogin } = await import('./loginFlow.js')

const now = () => Math.floor(Date.now() / 1000)
const claims = (nonce: string) => ({
  iss: issuer, aud: 'mice-web', exp: now() + 300, nonce,
  sub: 'u1', email: 'u1@example.com', email_verified: true,
})

async function keyFor(alg: 'RS256' | 'ES256', kid: string) {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' }
  return { privateKey, jwk, alg, kid }
}

async function login(sign: (nonce: string) => Promise<string>) {
  const start = await startLogin()
  const authorize = new URL(start.authorizeUrl)
  idToken = await sign(authorize.searchParams.get('nonce')!)
  return completeLogin({ code: 'c', state: authorize.searchParams.get('state')!, pkceCookie: start.pkceCookie })
}
const signWith = (k: Awaited<ReturnType<typeof keyFor>>, alg = k.alg) => (nonce: string) =>
  new SignJWT(claims(nonce)).setProtectedHeader({ alg, kid: k.kid }).sign(k.privateKey)

describe('id_token signature verification', () => {
  after(() => idp.close())

  it('accepts valid RS256 and ES256 tokens', async () => {
    const rs = await keyFor('RS256', 'rs1')
    const es = await keyFor('ES256', 'es1')
    jwks = [rs.jwk, es.jwk]
    assert.equal((await login(signWith(rs))).ok, true)
    assert.equal((await login(signWith(es))).ok, true)
  })

  it('rejects a bad signature, alg none, an unexpected algorithm and an unknown key', async () => {
    const good = await keyFor('RS256', 'rs2')
    const other = await keyFor('RS256', 'rs2')
    jwks = [good.jwk]
    assert.equal((await login(signWith(other))).ok, false, 'bad signature')
    assert.equal(
      (await login(async (n) => `${b64({ alg: 'none', kid: 'rs2' })}.${b64(claims(n))}.`)).ok,
      false,
      'alg none',
    )
    const hmac = new TextEncoder().encode('x'.repeat(32))
    assert.equal(
      (await login((n) => new SignJWT(claims(n)).setProtectedHeader({ alg: 'HS256', kid: 'rs2' }).sign(hmac))).ok,
      false,
      'HS256',
    )
    const stranger = await keyFor('RS256', 'unknown')
    assert.equal((await login(signWith(stranger))).ok, false, 'unknown key')
  })

  it('picks up a rotated key without a restart', async () => {
    const old = await keyFor('ES256', 'old')
    jwks = [old.jwk]
    assert.equal((await login(signWith(old))).ok, true)
    const next = await keyFor('ES256', 'new')
    jwks = [next.jwk]
    assert.equal((await login(signWith(next))).ok, true)
  })

  it('fails login when the key set cannot be fetched', async () => {
    const k = await keyFor('RS256', 'fresh-unfetched')
    jwks = [k.jwk]
    jwksDown = true
    try {
      const r = await login(signWith(k))
      assert.equal(r.ok, false)
    } finally {
      jwksDown = false
    }
  })
})
