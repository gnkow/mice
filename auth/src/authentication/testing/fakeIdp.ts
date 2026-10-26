import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'
import { systemClock, type Clock } from '../../clock.js'
import type { IdpAdapter, SignInOptions, SignInResult, TestUserSpec } from './idpAdapter.js'

/** The process-wide OIDC provider caches discovery, so every fake IdP in a process reuses the first port. */
let sharedPort = 0

export type FakeIdp = IdpAdapter & {
  /** Shifts the IdP's time against the clock it was given (IdP skew vs the BFF). */
  setOffset(ms: number): void
  /** Signs id_tokens with a key the IdP does not publish. */
  forgeSignatures(on: boolean): void
  /** How many times the key set has been fetched. */
  readonly jwksFetches: number
}

/**
 * In-process OIDC IdP issuing RS256-signed id_tokens and publishing the key set. Time comes from `clock` plus an adjustable offset, so tests can skew the IdP against the BFF.
 */
export async function createFakeIdp(opts: {
  clientId?: string
  clock?: Clock
  users?: Record<string, TestUserSpec>
} = {}): Promise<FakeIdp> {
  const clock = opts.clock ?? systemClock
  const clientId = opts.clientId ?? 'mice-web'
  const users = new Map(Object.entries(opts.users ?? {}))
  const codes = new Map<string, { key: string; nonce: string; authTime: number }>()
  let offsetMs = 0
  let forge = false
  let jwksFetches = 0
  const kid = 'fake-idp-key'
  const signingKey = await generateKeyPair('RS256', { extractable: true })
  const foreignKey = await generateKeyPair('RS256', { extractable: true })
  const publicJwk: JWK = { ...(await exportJWK(signingKey.publicKey)), kid, alg: 'RS256', use: 'sig' }
  let issuer = ''
  const nowSec = () => Math.floor((clock.now() + offsetMs) / 1000)

  function idToken(key: string, nonce: string, authTime: number): Promise<string> {
    const u = users.get(key)!
    const mfa = u.mfa === true
    const claims = {
      iss: issuer,
      aud: clientId,
      iat: nowSec(),
      exp: nowSec() + 300,
      nonce,
      sub: u.sub ?? key,
      email: u.email,
      email_verified: u.emailVerified ?? true,
      ...(u.name === null ? {} : { name: u.name ?? key }),
      preferred_username: key,
      groups: u.groups ?? [],
      ...(u.guest ? { guest: true } : {}),
      auth_time: authTime,
      amr: mfa ? ['pwd', 'otp'] : ['pwd'],
      acr: mfa ? 'mfa' : 'pwd',
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid })
      .sign(forge ? foreignKey.privateKey : signingKey.privateKey)
  }

  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url?.endsWith('/.well-known/openid-configuration')) {
      res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }))
      return
    }
    if (req.url === '/jwks') {
      jwksFetches++
      res.end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', async () => {
      const entry = codes.get(new URLSearchParams(body).get('code') ?? '')
      if (!entry || !users.has(entry.key) || users.get(entry.key)!.disabled) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }
      codes.delete(new URLSearchParams(body).get('code')!)
      res.end(JSON.stringify({ id_token: await idToken(entry.key, entry.nonce, entry.authTime) }))
    })
  })

  return {
    get issuer() {
      return issuer
    },
    clientId,
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(sharedPort, '127.0.0.1', resolve)
      })
      sharedPort = (server.address() as AddressInfo).port
      issuer = `http://127.0.0.1:${sharedPort}`
    },
    async stop() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    forgeSignatures(on) {
      forge = on
    },
    get jwksFetches() {
      return jwksFetches
    },
    setOffset(ms) {
      offsetMs = ms
    },
    addUser(key, spec) {
      users.set(key, spec)
    },
    async signIn(key, authorizeUrl, signInOpts: SignInOptions = {}): Promise<SignInResult> {
      const params = new URL(authorizeUrl).searchParams
      const state = params.get('state') ?? ''
      const user = users.get(key)
      if (!user) throw new Error(`test IdP has no user "${key}"`)
      if (user.disabled) return { ok: false, error: 'access_denied', state }
      const code = randomUUID()
      codes.set(code, {
        key,
        nonce: params.get('nonce') ?? '',
        authTime: nowSec() - (signInOpts.authAgeSec ?? 0),
      })
      return { ok: true, code, state }
    },
  }
}
