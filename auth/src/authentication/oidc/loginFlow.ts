import { createHash } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { loginStates } from '../../db/schema.js'
import { currentClock, type Clock } from '../../clock.js'
import { defaultOidcProvider, pkceChallenge, randomString, type OidcProvider } from './oidc.js'
import type { Directory } from '../directory/directoryTypes.js'
import { directoryNow } from '../directory/directory.js'
import {
  admitLoginAfterToken,
  failLogin,
  safeReauthReturnPath,
  safeReturnPath,
  type LoginRefuseSurface,
  type LoginResult,
} from './loginAdmission.js'

export const PKCE_COOKIE = 'mice_oidc_pkce'

/** Login state lives in Postgres for 10 minutes and is consumed by the first callback that presents it. */
export const LOGIN_STATE_TTL_MS = 10 * 60_000

export type { LoginRefuseSurface, LoginResult }
export { safeReturnPath, safeReauthReturnPath }

type PkceState = {
  verifier: string
  state: string
  nonce: string
  /** Optional relative path to return to after OIDC (e.g. /cli/device?user_code=…). */
  next?: string
  /** Step-up: who must re-authenticate and how fresh the result must be. */
  reauth?: { maxAge: number; sub: string; iss: string }
}

const hashId = (id: string) => createHash('sha256').update(id).digest('hex')

/** Begin an OIDC authorization-code login: the PKCE cookie value to set and the IdP redirect. */
async function beginLogin(
  provider: OidcProvider,
  clock: Clock,
  next?: string | null,
  reauth?: { maxAge: number; sub: string; iss: string },
): Promise<{ pkceCookie: string; authorizeUrl: string }> {
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const safeNext = reauth ? safeReauthReturnPath(next) : safeReturnPath(next)
  const pkce: PkceState = {
    verifier,
    state,
    nonce,
    ...(safeNext ? { next: safeNext } : {}),
    ...(reauth ? { reauth } : {}),
  }
  const pkceCookie = randomString(32)
  await getDb().delete(loginStates).where(lt(loginStates.expiresAt, new Date(clock.now())))
  await getDb().insert(loginStates).values({
    idHash: hashId(pkceCookie),
    state,
    nonce,
    codeVerifier: verifier,
    returnPath: pkce.next ?? null,
    reauth: pkce.reauth ?? null,
    expiresAt: new Date(clock.now() + LOGIN_STATE_TTL_MS),
  })
  return {
    pkceCookie,
    // Always prompt=login so SSO shows the IdP credential form (Keycloak SSO cookies can
    // survive a Mice-only logout).
    authorizeUrl: await provider.beginLogin({
      state,
      nonce,
      codeChallenge: challenge,
      promptLogin: true,
      ...(reauth ? { maxAge: reauth.maxAge } : {}),
    }),
  }
}

/** Deletes and returns the login state for a cookie: the state is single-use even when the callback then fails. */
async function consumeLoginState(clock: Clock, cookie: string | undefined): Promise<PkceState | null> {
  if (!cookie) return null
  const [row] = await getDb().delete(loginStates).where(eq(loginStates.idHash, hashId(cookie))).returning()
  if (!row || row.expiresAt.getTime() <= clock.now()) return null
  return {
    verifier: row.codeVerifier,
    state: row.state,
    nonce: row.nonce,
    ...(row.returnPath ? { next: row.returnPath } : {}),
    ...(row.reauth ? { reauth: row.reauth } : {}),
  }
}

/** Finish the login: validate state, exchange the code, then admit the Principal. */
async function finishLogin(
  provider: OidcProvider,
  directory: Directory,
  clock: Clock,
  input: {
    code?: string
    state?: string
    error?: string
    pkceCookie?: string
    requestId?: string
  },
): Promise<LoginResult> {
  const pkce = await consumeLoginState(clock, input.pkceCookie)
  if (input.error) return failLogin(400, `Login failed: ${input.error}`, !!pkce?.reauth)
  if (!input.code || !input.state || !input.pkceCookie) return failLogin(400, 'Missing OIDC state.')
  if (!pkce) return failLogin(400, 'Invalid OIDC state.')
  const isReauth = !!pkce.reauth
  if (pkce.state !== input.state) return failLogin(400, 'State mismatch.', isReauth)
  try {
    const user = await provider.completeLogin({
      code: input.code,
      codeVerifier: pkce.verifier,
      nonce: pkce.nonce,
    })
    return admitLoginAfterToken({
      user,
      directory,
      clock,
      pkce: { next: pkce.next, reauth: pkce.reauth },
      requestId: input.requestId,
    })
  } catch (e) {
    return failLogin(500, e instanceof Error ? e.message : 'login failed', isReauth)
  }
}

/** Login flow over an OIDC provider and clock. */
export function createLoginFlow(deps: { provider: OidcProvider; directory: Directory; clock?: Clock }) {
  const clock = deps.clock ?? currentClock
  return {
    startLogin: (next?: string | null, reauth?: { maxAge: number; sub: string; iss: string }) =>
      beginLogin(deps.provider, clock, next, reauth),
    completeLogin: (input: Parameters<typeof finishLogin>[3]) =>
      finishLogin(deps.provider, deps.directory, clock, input),
  }
}

/** Process-wide flow: the environment-configured provider and directory, resolved per call. */
const lazyProvider: OidcProvider = {
  beginLogin: (r) => defaultOidcProvider().beginLogin(r),
  completeLogin: (r) => defaultOidcProvider().completeLogin(r),
  logoutUrl: (o) => defaultOidcProvider().logoutUrl(o),
  verifyJwt: (t) => defaultOidcProvider().verifyJwt(t),
}
const lazyDirectory: Directory = {
  get configured() {
    return directoryNow().configured
  },
  get issuer() {
    return directoryNow().issuer
  },
  searchUsers: (q, l) => directoryNow().searchUsers(q, l),
  searchGroups: (q, l) => directoryNow().searchGroups(q, l),
  userStatus: (s) => directoryNow().userStatus(s),
  getUserGroups: (s) => directoryNow().getUserGroups(s),
  getGroup: (id) => directoryNow().getGroup(id),
}
const defaults = createLoginFlow({ provider: lazyProvider, directory: lazyDirectory })
export const startLogin = defaults.startLogin
export const completeLogin = defaults.completeLogin
