import { compactVerify, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose'
import { env, oidcConfigured } from '../../env.js'
import {
  claimsFromPayload,
  decodeJwtPayload,
  validateIdTokenClaims,
  type OidcClaims,
} from './oidcClaims.js'

export { pkceChallenge, randomString, validateIdTokenClaims } from './oidcClaims.js'
export type { OidcClaims } from './oidcClaims.js'

export type AuthorizeRequest = {
  state: string
  nonce: string
  codeChallenge: string
  /** Force the IdP to show the username/password form (no silent SSO). */
  promptLogin?: boolean
  /** Step-up: maximum seconds since the IdP authentication. */
  maxAge?: number
}

/** The IdP as the login flow sees it. */
export interface OidcProvider {
  /** The IdP URL to send the browser to. */
  beginLogin(req: AuthorizeRequest): Promise<string>
  /** Exchanges the authorization code and returns the validated identity claims. */
  completeLogin(req: { code: string; codeVerifier: string; nonce: string }): Promise<OidcClaims>
  /** RP-initiated logout URL, or null when the IdP offers none. */
  logoutUrl(opts: { idToken?: string }): Promise<string | null>
  /** Verifies a JWT issued by the IdP (signature, issuer, audience), e.g. a back-channel logout token. */
  verifyJwt(token: string): Promise<Record<string, unknown>>
}

export type OidcProviderConfig = {
  issuer: string
  /** Issuer as seen by the browser when it differs from the one the server reaches. */
  issuerPublic: string
  clientId: string
  clientSecret: string
  redirectUri: string
  postLogoutRedirectUri: string
  groupsClaim: string
}

type Discovered = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  endSessionEndpoint?: string
  jwksUri?: string
}

function rewriteHost(urlStr: string, base: string): string {
  const u = new URL(urlStr)
  const b = new URL(base.replace(/\/$/, ''))
  u.protocol = b.protocol
  u.host = b.host
  return u.toString()
}

/** Real OIDC adapter. Discovery and key-set caches belong to the instance. */
export function createOidcProvider(
  configSource: OidcProviderConfig | (() => OidcProviderConfig),
  deps: { fetch?: typeof fetch; nowSec?: () => number } = {},
): OidcProvider {
  const config = () => (typeof configSource === 'function' ? configSource() : configSource)
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  let discovered: Discovered | null = null

  async function discover(): Promise<Discovered> {
    if (discovered) return discovered
    const c = config()
    const issuer = c.issuer.replace(/\/$/, '')
    const res = await doFetch(`${issuer}/.well-known/openid-configuration`)
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
    const doc = (await res.json()) as {
      issuer: string
      authorization_endpoint: string
      token_endpoint: string
      end_session_endpoint?: string
      jwks_uri?: string
    }
    let { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint } = doc
    let endSessionEndpoint = doc.end_session_endpoint
    let jwksEndpoint = doc.jwks_uri
    // Browser hits the published Keycloak host; the BFF uses the Compose service name.
    if (c.issuerPublic && c.issuerPublic !== c.issuer) {
      authorizationEndpoint = rewriteHost(authorizationEndpoint, c.issuerPublic)
      tokenEndpoint = rewriteHost(tokenEndpoint, c.issuer)
      if (endSessionEndpoint) endSessionEndpoint = rewriteHost(endSessionEndpoint, c.issuerPublic)
      if (jwksEndpoint) jwksEndpoint = rewriteHost(jwksEndpoint, c.issuer)
    }
    discovered = {
      issuer: doc.issuer,
      authorizationEndpoint,
      tokenEndpoint,
      endSessionEndpoint,
      jwksUri: jwksEndpoint,
    }
    return discovered
  }

  /** The IdP key set, fetched on every call: no JWKS caching, an unreachable IdP means no verification. */
  async function keySet(uri: string | undefined): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (!uri) throw new Error('IdP publishes no jwks_uri; cannot verify tokens')
    const res = await doFetch(uri, { cache: 'no-store' })
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
    return createLocalJWKSet((await res.json()) as JSONWebKeySet)
  }

  const knownIssuers = (conf: Discovered) =>
    [conf.issuer, config().issuer, config().issuerPublic].filter(Boolean)

  return {
    async beginLogin(req) {
      const conf = await discover()
      const c = config()
      const u = new URL(conf.authorizationEndpoint)
      u.searchParams.set('client_id', c.clientId)
      u.searchParams.set('redirect_uri', c.redirectUri)
      u.searchParams.set('response_type', 'code')
      u.searchParams.set('scope', 'openid profile email')
      u.searchParams.set('state', req.state)
      u.searchParams.set('nonce', req.nonce)
      u.searchParams.set('code_challenge', req.codeChallenge)
      u.searchParams.set('code_challenge_method', 'S256')
      if (req.promptLogin) u.searchParams.set('prompt', 'login')
      if (req.maxAge !== undefined) u.searchParams.set('max_age', String(req.maxAge))
      return u.toString()
    },

    async completeLogin(req) {
      const conf = await discover()
      const c = config()
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.code,
        redirect_uri: c.redirectUri,
        client_id: c.clientId,
        code_verifier: req.codeVerifier,
      })
      if (c.clientSecret) body.set('client_secret', c.clientSecret)
      const res = await doFetch(conf.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
      const idToken = ((await res.json()) as { id_token?: string }).id_token
      if (!idToken) throw new Error('No id_token in token response')

      try {
        // Signature only: validity times are checked with the leeway in validateIdTokenClaims.
        await compactVerify(idToken, await keySet(conf.jwksUri), { algorithms: ['RS256', 'ES256'] })
      } catch (e) {
        throw new Error(`id_token signature verification failed: ${e instanceof Error ? e.message : e}`)
      }
      const payload = decodeJwtPayload(idToken)
      validateIdTokenClaims(payload, {
        issuers: knownIssuers(conf),
        audience: c.clientId,
        nonce: req.nonce,
        nowSec: deps.nowSec?.(),
      })
      return claimsFromPayload(payload, {
        idToken,
        fallbackIssuer: conf.issuer,
        groupsClaim: c.groupsClaim,
      })
    },

    async logoutUrl(opts) {
      const conf = await discover()
      if (!conf.endSessionEndpoint) return null
      const c = config()
      const u = new URL(conf.endSessionEndpoint)
      u.searchParams.set('client_id', c.clientId)
      u.searchParams.set('post_logout_redirect_uri', c.postLogoutRedirectUri)
      if (opts.idToken) u.searchParams.set('id_token_hint', opts.idToken)
      return u.toString()
    },

    async verifyJwt(token) {
      const conf = await discover()
      const issuers = knownIssuers(conf).flatMap((i) => [i.replace(/\/$/, ''), `${i.replace(/\/$/, '')}/`])
      const { payload } = await jwtVerify(token, await keySet(conf.jwksUri), {
        algorithms: ['RS256', 'ES256'],
        issuer: issuers,
        audience: config().clientId,
      })
      return payload as Record<string, unknown>
    },
  }
}

export function oidcConfigFromEnv(): OidcProviderConfig {
  return {
    issuer: env.oidcIssuer,
    issuerPublic: env.oidcIssuerPublic,
    clientId: env.oidcClientId,
    clientSecret: env.oidcClientSecret,
    redirectUri: env.oidcRedirectUri,
    postLogoutRedirectUri: env.oidcPostLogoutRedirectUri,
    groupsClaim: env.oidcGroupsClaim,
  }
}

let processProvider: OidcProvider | undefined

/** The process-wide provider, configured from the environment on first use. */
export function defaultOidcProvider(): OidcProvider {
  if (!oidcConfigured()) throw new Error('OIDC is not configured')
  processProvider ??= createOidcProvider(oidcConfigFromEnv)
  return processProvider
}

/** Delegating wrappers for callers that use the process-wide provider. */
export const exchangeCode = (req: { code: string; codeVerifier: string; nonce: string }) =>
  defaultOidcProvider().completeLogin(req)
export const buildEndSessionUrl = (opts: { idToken?: string }) => defaultOidcProvider().logoutUrl(opts)
export const verifyIdpJwt = (token: string) => defaultOidcProvider().verifyJwt(token)
