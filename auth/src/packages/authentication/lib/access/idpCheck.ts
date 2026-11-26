/**
 * Live IdP status checking for access control (Ticket 19 / U3).
 *
 * Every authenticated request evaluates IdP user status with no throttle and
 * no last-check cache. Unreachable directory or disabled user → 503.
 * Ordinary reads keep groups captured on the Session (bounded by session TTL).
 */

import type { SessionUser } from '../session/session.js'
import { directoryNow, type DirectoryUserState } from '../directory/directory.js'
import { decideIdpDisplayNameGate } from '../oidc/idpDisplayName.js'
import { recordIdpCheck, type IdpCheckRecord } from '../compliance/idpOutage.js'
import { recordIdpDisabled } from './reenable.js'
import type { PrincipalId } from '../session/principal.js'

export type LiveIdpLookup = (sub: string) => Promise<DirectoryUserState>

export type LiveIdpDenial =
  | { kind: 'unreachable'; status: 503; error: string }
  | { kind: 'disabled'; status: 503; error: string; account: DirectoryUserState }
  | { kind: 'missing'; status: 503; error: string; account: DirectoryUserState }
  | { kind: 'nameless'; status: 403; error: string; account: DirectoryUserState }

export type LiveIdpAccessResult =
  | { ok: true; kind: 'allowed'; account: DirectoryUserState }
  | ({ ok: false } & LiveIdpDenial)

export type SettleLiveIdpAccessDeps = {
  lookup?: LiveIdpLookup
  now?: () => number
  requestId?: string
  recordCheck?: (input: IdpCheckRecord) => Promise<void>
  recordDisabled?: (principal: PrincipalId & { name?: string; email?: string }) => Promise<void>
}

const UNAVAILABLE = 'Service Unavailable - IdP check failed'

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
    return { ok: false, kind: 'unreachable', status: 503, error: UNAVAILABLE }
  }

  if (account.status === 'error') {
    return { ok: false, kind: 'unreachable', status: 503, error: UNAVAILABLE }
  }

  if (account.status === 'disabled') {
    return {
      ok: false,
      kind: 'disabled',
      status: 503,
      error: UNAVAILABLE,
      account,
    }
  }

  if (account.status === 'missing') {
    // Keep 503 to match existing live-request behaviour (login uses 403 separately).
    return {
      ok: false,
      kind: 'missing',
      status: 503,
      error: UNAVAILABLE,
      account,
    }
  }

  const nameGate = decideIdpDisplayNameGate(account.name)
  if (!nameGate.ok) {
    return {
      ok: false,
      kind: 'nameless',
      status: nameGate.status,
      error: nameGate.error,
      account,
    }
  }

  return { ok: true, kind: 'allowed', account }
}

/**
 * Authenticated-request gate: evaluate live IdP access, then record outage /
 * disabled side effects. Callers only map the result to HTTP.
 */
export async function settleLiveIdpAccess(
  user: SessionUser,
  deps: SettleLiveIdpAccessDeps = {},
): Promise<LiveIdpAccessResult> {
  const lookup = deps.lookup ?? ((sub) => directoryNow().userStatus(sub))
  const now = deps.now ?? Date.now
  const recordCheck = deps.recordCheck ?? recordIdpCheck
  const recordDisabled = deps.recordDisabled ?? recordIdpDisabled

  const live = await evaluateLiveIdpAccess(user, lookup)
  if (live.kind === 'unreachable') {
    await recordCheck({
      reachable: false,
      at: now(),
      check: 'authenticated-request',
      requestId: deps.requestId ?? 'authenticated-request',
    })
  } else {
    await recordCheck({ reachable: true, at: now() })
  }
  if (live.kind === 'disabled') {
    await recordDisabled(user)
  }
  return live
}
