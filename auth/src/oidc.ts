import { normalizeGroupsClaim } from './authzTypes.js'
import { env, oidcConfigured } from './env.js'

export type OidcConfig = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  endSessionEndpoint?: string
  jwksUri?: string
}

let cached: OidcConfig | null = null

function rewriteHost(urlStr: string, base: string): string {
  const u = new URL(urlStr)
  const b = new URL(base.replace(/\/$/, ''))
  u.protocol = b.protocol
  u.host = b.host
  return u.toString()
}

export async function loadOidcConfig(): Promise<OidcConfig> {
  if (!oidcConfigured()) {
    throw new Error('OIDC is not configured')
  }
  if (cached) return cached

  const issuer = env.oidcIssuer.replace(/\/$/, '')
  const res = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status}`)
  }
  const doc = (await res.json()) as {
    issuer: string
    authorization_endpoint: string
    token_endpoint: string
    end_session_endpoint?: string
    jwks_uri?: string
  }

  let authorizationEndpoint = doc.authorization_endpoint
  let tokenEndpoint = doc.token_endpoint
  let endSessionEndpoint = doc.end_session_endpoint
  // Browser hits the published Keycloak host; the BFF uses the Compose service name.
  if (env.oidcIssuerPublic && env.oidcIssuerPublic !== env.oidcIssuer) {
    authorizationEndpoint = rewriteHost(
      authorizationEndpoint,
      env.oidcIssuerPublic,
    )
    tokenEndpoint = rewriteHost(tokenEndpoint, env.oidcIssuer)
    if (endSessionEndpoint) {
      endSessionEndpoint = rewriteHost(endSessionEndpoint, env.oidcIssuerPublic)
    }
  }

  cached = {
    issuer: doc.issuer,
    authorizationEndpoint,
    tokenEndpoint,
    endSessionEndpoint,
    jwksUri: doc.jwks_uri,
  }
  return cached
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return b64url(new Uint8Array(digest))
}

export function buildAuthorizeUrl(opts: {
  state: string
  nonce: string
  codeChallenge: string
  /** Force the IdP to show the username/password form (no silent SSO). */
  promptLogin?: boolean
}): string {
  if (!cached) throw new Error('OIDC config not loaded')
  const u = new URL(cached.authorizationEndpoint)
  u.searchParams.set('client_id', env.oidcClientId)
  u.searchParams.set('redirect_uri', env.oidcRedirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid profile email')
  u.searchParams.set('state', opts.state)
  u.searchParams.set('nonce', opts.nonce)
  u.searchParams.set('code_challenge', opts.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (opts.promptLogin) {
    u.searchParams.set('prompt', 'login')
  }
  return u.toString()
}

/** RP-initiated logout URL (browser → IdP → back to Boxen /login). */
export async function buildEndSessionUrl(opts: {
  idToken?: string
}): Promise<string | null> {
  const conf = await loadOidcConfig()
  if (!conf.endSessionEndpoint) return null
  const u = new URL(conf.endSessionEndpoint)
  u.searchParams.set('client_id', env.oidcClientId)
  u.searchParams.set('post_logout_redirect_uri', env.oidcPostLogoutRedirectUri)
  if (opts.idToken) {
    u.searchParams.set('id_token_hint', opts.idToken)
  }
  return u.toString()
}

export async function exchangeCode(opts: {
  code: string
  codeVerifier: string
}): Promise<{
  sub: string
  iss: string
  email: string
  name: string
  idToken: string
  groups: string[]
}> {
  const conf = await loadOidcConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: env.oidcRedirectUri,
    client_id: env.oidcClientId,
    code_verifier: opts.codeVerifier,
  })
  if (env.oidcClientSecret) {
    body.set('client_secret', env.oidcClientSecret)
  }

  const res = await fetch(conf.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }
  const tokens = (await res.json()) as {
    id_token?: string
    access_token?: string
  }
  const idToken = tokens.id_token
  if (!idToken) throw new Error('No id_token in token response')

  const payloadPart = idToken.split('.')[1]
  if (!payloadPart) throw new Error('Malformed id_token')
  const payload = JSON.parse(
    Buffer.from(
      payloadPart.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8'),
  ) as Record<string, unknown>

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const iss =
    typeof payload.iss === 'string' ? payload.iss : conf.issuer
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : `${sub}@users.local`
  const preferred =
    typeof payload.preferred_username === 'string'
      ? payload.preferred_username
      : ''
  const name =
    (typeof payload.name === 'string' ? payload.name : '') ||
    preferred ||
    email.split('@')[0] ||
    sub
  if (!sub) throw new Error('id_token missing sub')
  const groups = normalizeGroupsClaim(payload[env.oidcGroupsClaim])
  return { sub, iss, email, name, idToken, groups }
}
