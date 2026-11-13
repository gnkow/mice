/**
 * IdP directory status at login (Ticket 38; disabled/missing from Ticket 04).
 *
 * Maps a directory userStatus result to allow / refuse. Side effects
 * (outage recording via recordIdpCheck, IdP-disabled history) stay in the loginFlow caller.
 */

import type { DirectoryUserStatus } from '../directory/directoryTypes.js'

export type LoginDirectoryDecision =
  | { allow: true }
  | {
      allow: false
      httpStatus: 403 | 503
      message: string
      recordDisabled: boolean
    }

/** Decide whether finishLogin may create a Session for this directory status. */
export function decideLoginDirectoryStatus(
  status: DirectoryUserStatus,
): LoginDirectoryDecision {
  switch (status) {
    case 'enabled':
      return { allow: true }
    case 'disabled':
      return {
        allow: false,
        httpStatus: 403,
        message: 'Your account has been disabled by the administrator.',
        recordDisabled: true,
      }
    case 'missing':
      return {
        allow: false,
        httpStatus: 403,
        message: 'Your account was not found in the directory.',
        recordDisabled: false,
      }
    case 'error':
      return {
        allow: false,
        httpStatus: 503,
        message: 'IdP is unreachable. Login cannot be verified at this time.',
        recordDisabled: false,
      }
  }
}
