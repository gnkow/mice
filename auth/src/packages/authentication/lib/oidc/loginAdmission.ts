/**
 * Post-token login admission (Ticket 20).
 *
 * After the OIDC code exchange, `admitLoginAfterToken` owns directory/name/
 * reenable/suspend/overage/reauth/groups. `finishLogin` only consumes PKCE
 * state and exchanges the code.
 */

import type { Clock } from '../../../shared/index.js'
import { actorFromUser } from '../../../audit/index.js'
import { appendAudit } from '../../../audit/index.js'
import { EMPTY_AUDIT_CHANGE } from '../../../audit/change.js'
import type { Directory } from '../directory/directoryTypes.js'
import { isSuspended } from '../access/miceSuspension.js'
import { considerReenable, recordIdpDisabled } from '../access/reenable.js'
import { canonicalIssuer } from '../session/principal.js'
import type { SessionUser } from '../session/session.js'
import { recordIdpCheck } from '../compliance/idpOutage.js'
import { resolveGroupOverage } from './groupOverage.js'
import { decideIdpDisplayNameGate } from './idpDisplayName.js'
import {
  settleLoginDirectoryFromDirectory,
  type LoginDirectoryRefuseSurface,
} from './loginDirectoryStatus.js'
import type { OidcClaims } from './oidc.js'

/** LoginPage `?status=` codes for refuse/outage surfaces (tickets 04, 32, 38). */
export type LoginRefuseSurface = LoginDirectoryRefuseSurface | 'empty_name'

export type LoginResult =
  | { ok: true; user: SessionUser; dest: string; reauth?: { maxAge: number; sub: string; iss: string } }
  | {
      ok: false
      status: 400 | 403 | 500 | 503
      html: string
      reauth?: boolean
      reason?: string
      /** When set, `/auth/callback` redirects to LoginPage instead of bare HTML. */
      surface?: LoginRefuseSurface
    }

const retry = '<a href="/auth/login">Retry</a>'

/** Build a refuse LoginResult with optional LoginPage surface and step-up reason. */
export function failLogin(
  status: 400 | 403 | 500 | 503,
  msg: string,
  reauth = false,
  surface?: LoginRefuseSurface,
): LoginResult {
  return {
    ok: false,
    status,
    html: `<p>${msg}</p><p>${retry}</p>`,
    ...(surface ? { surface } : {}),
    ...(reauth ? { reauth: true, reason: msg } : {}),
  }
}

/** Only same-site relative paths outside the login and auth routes are valid return targets. */
export function safeReturnPath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return undefined
  return raw
}

/** Step-up may resume an /auth/step-up/ action; every other /auth/ path stays blocked. */
export function safeReauthReturnPath(raw: string | undefined | null): string | undefined {
  if (raw?.startsWith('/auth/step-up/') && !raw.startsWith('//')) return raw
  return safeReturnPath(raw)
}

export type LoginAdmissionPkce = {
  next?: string
  reauth?: { maxAge: number; sub: string; iss: string }
}

/**
 * Admit a Principal after a successful token exchange: directory, name, reenable,
 * suspension, group overage, step-up freshness, then Session groups.
 */
export async function admitLoginAfterToken(input: {
  user: OidcClaims
  directory: Directory
  clock: Clock
  pkce: LoginAdmissionPkce
  requestId?: string
}): Promise<LoginResult> {
  const { user, directory, clock, pkce, requestId } = input
  const isReauth = !!pkce.reauth
  const { account, gate: directoryGate } = await settleLoginDirectoryFromDirectory({
    directory,
    sub: user.sub,
    now: clock.now(),
    requestId: requestId ?? 'login',
    recordIdpCheck,
    recordDisabled: () => recordIdpDisabled(user),
  })
  if (!directoryGate.allow) {
    return failLogin(
      directoryGate.httpStatus,
      directoryGate.message,
      isReauth,
      directoryGate.surface,
    )
  }
  const nameGate = decideIdpDisplayNameGate(account.name)
  if (!nameGate.ok) {
    const iss = canonicalIssuer(user.iss)
    await appendAudit({
      actor: { sub: user.sub, iss, email: user.email, name: '' },
      via: 'session',
      method: 'GET',
      path: '/auth/callback',
      status: nameGate.status,
      action: 'auth.login.failed',
      change: EMPTY_AUDIT_CHANGE,
      message: `Refused login ${iss}|${user.sub}`,
    })
    return failLogin(nameGate.status, nameGate.error, isReauth, 'empty_name')
  }
  const reenable = await considerReenable(user, async (event) => {
    const stored = await appendAudit({
      actor: actorFromUser(user),
      via: 'session',
      method: 'GET',
      path: '/auth/callback',
      status: 200,
      action: 'auth.reenable.automatic',
      change: event.change ?? EMPTY_AUDIT_CHANGE,
      message: event.message,
      detail: event.detail,
    })
    return stored?.id ?? null
  })
  if (reenable === 'awaiting-confirmation') {
    return failLogin(403, 'Re-enable confirmation required', isReauth)
  }
  if (await isSuspended({ iss: user.iss, sub: user.sub })) {
    const iss = canonicalIssuer(user.iss)
    await appendAudit({
      actor: { sub: user.sub, iss, email: user.email, name: user.name },
      via: 'session',
      method: 'GET',
      path: '/auth/callback',
      status: 403,
      action: 'auth.suspended',
      change: EMPTY_AUDIT_CHANGE,
      message: `Refused login ${iss}|${user.sub}`,
    })
    return failLogin(403, 'Suspended', isReauth)
  }

  let claimsForSession = user
  if (user.groupsOverage) {
    const resolved = await resolveGroupOverage(user, directory)
    if (!resolved.ok) {
      return failLogin(
        500,
        'Group membership could not be determined. Please contact your administrator.',
        isReauth,
      )
    }
    claimsForSession = resolved.claims
  }

  if (pkce.reauth) {
    if (user.sub !== pkce.reauth.sub || user.iss !== pkce.reauth.iss) {
      return failLogin(400, 'Re-authentication was completed by a different account.', true)
    }
    const age = Math.floor(clock.now() / 1000) - (user.authTime ?? 0)
    if (user.authTime === undefined || age > pkce.reauth.maxAge + 5) {
      return failLogin(400, 'Re-authentication was not recent enough.', true)
    }
  }
  const { groups, nameBasedFallback } = await sessionGroups(claimsForSession, directory)
  return {
    ok: true,
    ...(pkce.reauth ? { reauth: pkce.reauth } : {}),
    dest: (pkce.reauth ? safeReauthReturnPath(pkce.next) : safeReturnPath(pkce.next)) ?? '/',
    user: {
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      ...(user.emailVerified ? { emailVerified: true } : {}),
      name: account.name,
      idToken: user.idToken,
      ...(user.authTime !== undefined ? { authTime: user.authTime } : {}),
      ...(groups.length ? { groups } : {}),
      ...(nameBasedFallback ? { groupsNameBasedFallback: true } : {}),
    },
  }
}

/**
 * Binding keys from the token plus directory object ids, and refresh the display-name cache.
 */
async function sessionGroups(
  user: { sub: string; iss: string; groups: string[]; groupsNameBasedFallback?: boolean },
  directory: Directory,
): Promise<{ groups: string[]; nameBasedFallback: boolean }> {
  const {
    groupBindingKey,
    isGroupObjectId,
    parseGroupBindingKey,
    toGroupBindingKey,
  } = await import('../../../authz/index.js')
  const { upsertGroupDisplayNames } = await import('../../../authz/index.js')
  const iss = user.iss
  const keys = new Set<string>()
  const cacheRows: Array<{ bindingKey: string; displayName: string; idBased: boolean }> = []
  let nameBasedFallback = !!user.groupsNameBasedFallback

  for (const g of user.groups) {
    const parsed = parseGroupBindingKey(g)
    if (parsed) {
      if (!isGroupObjectId(parsed.groupId)) {
        nameBasedFallback = true
        continue
      }
      keys.add(groupBindingKey(parsed.iss, parsed.groupId))
      continue
    }
    const resolved = toGroupBindingKey(iss, g)
    if (!resolved.idBased) {
      nameBasedFallback = true
      continue
    }
    keys.add(resolved.bindingKey)
  }

  if (directory.configured) {
    try {
      const listed = await directory.getUserGroups(user.sub)
      const dirIss = directory.issuer || iss
      for (const group of listed) {
        if (!group.id?.trim()) continue
        if (!isGroupObjectId(group.id)) {
          nameBasedFallback = true
          continue
        }
        const bindingKey = groupBindingKey(dirIss, group.id)
        keys.add(bindingKey)
        cacheRows.push({
          bindingKey,
          displayName: group.name || group.id,
          idBased: true,
        })
      }
    } catch (err) {
      console.error('[mice-auth] directory group id lookup failed', err)
    }
  }

  if (cacheRows.length) await upsertGroupDisplayNames(cacheRows)
  return { groups: [...keys], nameBasedFallback }
}
