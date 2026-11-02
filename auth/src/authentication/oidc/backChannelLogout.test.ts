import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'

let jwks: JWK[] = []
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
  res.end(JSON.stringify({ keys: jwks }))
})
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
const issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-bcl-'))
process.env.OIDC_ISSUER = issuer
process.env.OIDC_CLIENT_ID = 'mice-web'
process.env.OIDC_REDIRECT_URI = 'http://localhost/auth/callback'
process.env.SESSION_SECRET = 'test-session-secret-for-bcl'
process.env.OIDC_JWKS_COOLDOWN_MS = '0'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('../session/requireAuth.js')
const { backChannelLogout } = await import('./backChannelLogout.js')
const { sealSession } = await import('../session/session.js')
const { createPat } = await import('../credentials/tokens.js')
const { queryAudit } = await import('../../audit.js')
const { env } = await import('../../env.js')

const app = new Hono()
applyGlobalGuards(app)
app.post('/auth/backchannel-logout', backChannelLogout)
app.get('/whoami', async (c) => {
  const a = await authenticateRequest(c, { allowScoped: true })
  return a ? c.json({ via: a.via }) : c.json({}, 401)
})

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
jwks = [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }]

const EVENT = 'http://schemas.openid.net/event/backchannel-logout'
const now = () => Math.floor(Date.now() / 1000)
const mk = (sub: string) => ({ sub, iss: issuer, email: `${sub}@x.io`, name: sub })

async function logoutToken(over: Record<string, unknown> = {}, key = privateKey) {
  const claims = {
    iss: issuer, aud: 'mice-web', iat: now(), jti: `j${Math.random()}`,
    sub: 'u1', events: { [EVENT]: {} }, ...over,
  }
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
  if (!('exp' in over)) jwt.setExpirationTime(now() + 120)
  return jwt.sign(key)
}
const post = (token: string) =>
  app.request('/auth/backchannel-logout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ logout_token: token }),
  })
const cookie = async (sub: string, age = 30) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: now() - age })}`
const alive = async (headers: Record<string, string>) =>
  (await app.request('/whoami', { headers })).status === 200

await describe('back-channel logout', async () => {
  after(() => idp.close())

  await it('ends Sessions of the Principal and leaves PATs valid', async () => {
    const stale = await cookie('u1')
    const { token } = await createPat(mk('u1'), 'cli')
    assert.equal(await alive({ cookie: stale }), true)
    const res = await post(await logoutToken())
    assert.equal(res.status, 200)
    assert.equal(await alive({ cookie: stale }), false)
    assert.equal(await alive({ authorization: `Bearer ${token}` }), true)
  })

  await it('rejects forged, expired, wrong-audience, wrong-issuer and non-logout tokens with no effect', async () => {
    const other = await generateKeyPair('RS256')
    const cases: Array<[string, string]> = [
      ['forged', await logoutToken({ sub: 'u2' }, other.privateKey)],
      ['expired', await logoutToken({ sub: 'u2', exp: now() - 10 })],
      ['audience', await logoutToken({ sub: 'u2', aud: 'someone-else' })],
      ['issuer', await logoutToken({ sub: 'u2', iss: 'https://evil.example' })],
      ['no event', await logoutToken({ sub: 'u2', events: {} })],
      ['nonce', await logoutToken({ sub: 'u2', nonce: 'n' })],
      ['no sub', await logoutToken({ sub: undefined })],
      ['no jti', await logoutToken({ sub: 'u2', jti: undefined })],
    ]
    const live = await cookie('u2')
    for (const [name, token] of cases) {
      assert.equal((await post(token)).status, 400, name)
    }
    assert.equal(await alive({ cookie: live }), true)
  })

  await it('rejects jti replay: a later Session survives', async () => {
    const t = await logoutToken({ sub: 'u3', iat: now() - 5 })
    assert.equal((await post(t)).status, 200)
    const fresh = await cookie('u3', 0)
    assert.equal((await post(t)).status, 400)
    assert.equal(await alive({ cookie: fresh }), true)
  })

  await it('audits the Principal with source back-channel-logout', async () => {
    await post(await logoutToken({ sub: 'u4' }))
    const ev = (await queryAudit({ actor: 'u4', action: 'session.revoke' })).events[0]
    assert.equal(ev?.actor.sub, 'u4')
    assert.equal(ev?.detail?.source, 'back-channel-logout')
  })
})
