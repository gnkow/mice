import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import type { Clock } from '../../clock.js'
import type { IdpAdapter, SignInOptions, SignInResult, TestUserSpec } from './idpAdapter.js'

/**
 * In-process IdP that speaks the authorization-code endpoints the production OIDC client calls.
 * Tokens are RS256 and the discovery document publishes the matching key.
 */
export async function createFakeIdpAdapter(opts: { clock: Clock }): Promise<IdpAdapter> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fake', alg: 'RS256', use: 'sig' }
  const users = new Map<string, TestUserSpec & { sub: string }>()
  const codes = new Map<string, string>()
  let issuer = 'http://127.0.0.1:0'
  const clientId = 'mice-web'
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    res.setHeader('content-type', 'application/json')
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      }))
      return
    }
    if (url.pathname === '/jwks') {
      res.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    if (url.pathname === '/token') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = new URLSearchParams(Buffer.concat(chunks).toString())
      const token = codes.get(body.get('code') ?? '')
      if (!token) {
        res.statusCode = 400
        res.end('{}')
        return
      }
      res.end(JSON.stringify({ id_token: token }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })

  return {
    clientId,
    get issuer() {
      return issuer
    },
    async start() {
      if (server.listening) return
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    },
    async stop() {
      if (!server.listening) return
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    },
    addUser(key, spec) {
      users.set(key, { ...spec, sub: spec.sub ?? key })
    },
    async signIn(key, authorizeUrl, options?: SignInOptions): Promise<SignInResult> {
      const url = new URL(authorizeUrl)
      const state = url.searchParams.get('state') ?? ''
      const user = users.get(key)
      if (!user || user.disabled) return { ok: false, error: 'access_denied', state }
      const now = Math.floor(opts.clock.now() / 1000)
      const claims: Record<string, unknown> = {
        email: user.email,
        nonce: url.searchParams.get('nonce'),
        auth_time: now - (options?.authAgeSec ?? 0),
        amr: user.mfa ? ['pwd', 'otp'] : ['pwd'],
        acr: user.mfa ? 'mfa' : 'pwd',
        email_verified: user.emailVerified !== false,
      }
      if (user.name !== null) claims.name = user.name ?? key
      if (user.groups) claims.groups = user.groups
      if (user.guest) claims.guest = true
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'fake' })
        .setIssuer(issuer)
        .setAudience(url.searchParams.get('client_id') ?? clientId)
        .setSubject(user.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey)
      const code = randomBytes(16).toString('hex')
      codes.set(code, token)
      return { ok: true, code, state }
    },
  }
}
