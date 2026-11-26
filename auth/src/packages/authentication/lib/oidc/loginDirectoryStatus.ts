/**
 * IdP directory status at login (Ticket 38; disabled/missing from Ticket 04).
 *
 * `decideLoginDirectoryStatus` is pure allow/refuse + which IdP check to record.
 * `applyLoginDirectoryDecision` owns the side-effect order (reachability first,
 * then IdP-disabled history). `settleLoginDirectoryStatus` shapes IdP-check
 * payloads; `settleLoginDirectoryFromDirectory` also owns the userStatus lookup
 * so admission only maps the gate.
 */

import type { IdpCheckRecord } from '../compliance/idpOutage.js'
import type {
  DirectoryUserState,
  DirectoryUserStatus,
} from '../directory/directoryTypes.js'

/** Stable LoginPage `?status=` codes for directory refuses (tickets 04, 38). */
export type LoginDirectoryRefuseSurface = 'disabled' | 'missing' | 'unreachable'

export type LoginDirectoryDecision =
  | { allow: true; idpCheck: 'reachable' }
  | {
      allow: false
      httpStatus: 403 | 503
      message: string
      recordDisabled: boolean
      idpCheck: 'reachable' | 'unreachable'
      surface: LoginDirectoryRefuseSurface
    }

export type LoginDirectoryEffects = {
  recordIdpCheck: (reachable: boolean) => Promise<void>
  recordDisabled: () => Promise<void>
}

export type LoginDirectoryGate =
  | { allow: true }
  | {
      allow: false
      httpStatus: 403 | 503
      message: string
      surface: LoginDirectoryRefuseSurface
    }

/** Decide whether finishLogin may create a Session for this directory status. */
export function decideLoginDirectoryStatus(
  status: DirectoryUserStatus,
): LoginDirectoryDecision {
  switch (status) {
    case 'enabled':
      return { allow: true, idpCheck: 'reachable' }
    case 'disabled':
      return {
        allow: false,
        httpStatus: 403,
        message: 'Your account has been disabled by the administrator.',
        recordDisabled: true,
        idpCheck: 'reachable',
        surface: 'disabled',
      }
    case 'missing':
      return {
        allow: false,
        httpStatus: 403,
        message: 'Your account was not found in the directory.',
        recordDisabled: false,
        idpCheck: 'reachable',
        surface: 'missing',
      }
    case 'error':
      return {
        allow: false,
        httpStatus: 503,
        message: 'IdP is unreachable. Login cannot be verified at this time.',
        recordDisabled: false,
        idpCheck: 'unreachable',
        surface: 'unreachable',
      }
  }
}

/**
 * Apply a directory decision: record reachability, then IdP-disabled history when
 * needed, then return the gate finishLogin maps to Session-or-fail.
 */
export async function applyLoginDirectoryDecision(
  decision: LoginDirectoryDecision,
  effects: LoginDirectoryEffects,
): Promise<LoginDirectoryGate> {
  await effects.recordIdpCheck(decision.idpCheck === 'reachable')
  if (!decision.allow) {
    if (decision.recordDisabled) await effects.recordDisabled()
    return {
      allow: false,
      httpStatus: decision.httpStatus,
      message: decision.message,
      surface: decision.surface,
    }
  }
  return { allow: true }
}

/** Decide and apply in one call — thin adapter over decide + apply. */
export async function gateLoginDirectoryStatus(
  status: DirectoryUserStatus,
  effects: LoginDirectoryEffects,
): Promise<LoginDirectoryGate> {
  return applyLoginDirectoryDecision(decideLoginDirectoryStatus(status), effects)
}

/** Context for settling a directory status into IdP-check + disabled history writes. */
export type LoginDirectorySettleContext = {
  now: number
  requestId: string
  recordIdpCheck: (rec: IdpCheckRecord) => Promise<void>
  recordDisabled: () => Promise<void>
}

/**
 * Settle a directory status: shape reachable/unreachable IdP-check records, then
 * apply decide + side-effect order. Callers map the gate; they do not branch on
 * check payload shape.
 */
export async function settleLoginDirectoryStatus(
  status: DirectoryUserStatus,
  ctx: LoginDirectorySettleContext,
): Promise<LoginDirectoryGate> {
  return gateLoginDirectoryStatus(status, {
    recordIdpCheck: async (reachable) => {
      if (reachable) {
        await ctx.recordIdpCheck({ reachable: true, at: ctx.now })
      } else {
        await ctx.recordIdpCheck({
          reachable: false,
          at: ctx.now,
          check: 'login',
          requestId: ctx.requestId,
        })
      }
    },
    recordDisabled: ctx.recordDisabled,
  })
}

/** Directory lookup + settle — the admitLoginAfterToken directory gate seam. */
export async function settleLoginDirectoryFromDirectory(input: {
  directory: { userStatus(sub: string): Promise<DirectoryUserState> }
  sub: string
  now: number
  requestId: string
  recordIdpCheck: (rec: IdpCheckRecord) => Promise<void>
  recordDisabled: () => Promise<void>
}): Promise<{ account: DirectoryUserState; gate: LoginDirectoryGate }> {
  const account = await input.directory.userStatus(input.sub)
  const gate = await settleLoginDirectoryStatus(account.status, {
    now: input.now,
    requestId: input.requestId,
    recordIdpCheck: input.recordIdpCheck,
    recordDisabled: input.recordDisabled,
  })
  return { account, gate }
}
