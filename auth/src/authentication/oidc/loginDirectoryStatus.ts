/**
 * IdP directory status at login (Ticket 38; disabled/missing from Ticket 04).
 *
 * `decideLoginDirectoryStatus` is pure allow/refuse + which IdP check to record.
 * `applyLoginDirectoryDecision` owns the side-effect order (reachability first,
 * then IdP-disabled history) so finishLogin does not re-branch on those flags.
 */

import type { DirectoryUserStatus } from '../directory/directoryTypes.js'

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

/** Decide and apply in one call — the finishLogin directory gate seam. */
export async function gateLoginDirectoryStatus(
  status: DirectoryUserStatus,
  effects: LoginDirectoryEffects,
): Promise<LoginDirectoryGate> {
  return applyLoginDirectoryDecision(decideLoginDirectoryStatus(status), effects)
}
