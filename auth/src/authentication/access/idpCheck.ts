/**
 * Live IdP status checking for access control (Ticket 19 / U3).
 *
 * Every authenticated request evaluates IdP user status with no throttle and
 * no last-check cache. Unreachable directory or disabled user → 503.
 * Ordinary reads keep groups captured on the Session (bounded by session TTL).
 */

import type { SessionUser } from '../session/session.js'
import { directoryNow, type DirectoryUserState } from '../directory/directory.js'
import { hasIdpDisplayName } from '../oidc/idpDisplayName.js'

export type LiveIdpLookup = (sub: string) => Promise<DirectoryUserState>

export type LiveIdpAccessResult =
  | { ok: true; reachable: true; account: DirectoryUserState }
  | {
      ok: false
      reachable: boolean
      status: 503 | 403
      error: string
      account?: DirectoryUserState
      disabled?: boolean
    }

const UNAVAILABLE = 'Service Unavailable - IdP check failed'
const NO_NAME = 'Your account has no name in the identity provider.'

/**
 * Live IdP access decision for an authenticated request.
 * Lookup is injectable for tests; production uses the configured directory.
 */
export async function evaluateLiveIdpAccess(
  user: Pick<SessionUser, 'sub'>,
  lookup: LiveIdpLookup = (sub) => directoryNow().userStatus(sub),
): Promise<LiveIdpAccessResult> {
  let account: DirectoryUserState
  try {
    account = await lookup(user.sub)
  } catch {
    return { ok: false, reachable: false, status: 503, error: UNAVAILABLE }
  }

  if (account.status === 'error') {
    return { ok: false, reachable: false, status: 503, error: UNAVAILABLE }
  }

  if (account.status !== 'enabled') {
    return {
      ok: false,
      reachable: true,
      status: 503,
      error: UNAVAILABLE,
      account,
      disabled: account.status === 'disabled',
    }
  }

  if (!hasIdpDisplayName(account.name)) {
    return { ok: false, reachable: true, status: 403, error: NO_NAME, account }
  }

  return { ok: true, reachable: true, account }
}

/**
 * Raw IdP account state. Throws when the directory cannot answer.
 * Prefer `evaluateLiveIdpAccess` for authenticated-request gates.
 */
export async function checkUserIdpStatus(user: SessionUser): Promise<DirectoryUserState> {
  const account = await directoryNow().userStatus(user.sub)
  if (account.status === 'error') {
    throw new Error('IdP is unreachable - cannot verify user status')
  }
  return account
}

/** True when a live IdP check allows access (enabled + named). */
export async function verifyIdpAccess(user: SessionUser): Promise<boolean> {
  return (await evaluateLiveIdpAccess(user)).ok
}
