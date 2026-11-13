/**
 * Clear copy for privileged-path directory / group failures (ticket 37).
 * Settings actions that re-check IdP groups (sign, revoke, admin grants) use this.
 */

export type PrivilegedActionErrorKind = 'directory_unavailable' | 'group_invalid' | 'other'

export type PrivilegedActionError = {
  kind: PrivilegedActionErrorKind
  /** role=alert body */
  message: string
}

const DIRECTORY_RE =
  /directory unavailable|idp (?:is )?unreachable|identity provider unavailable|service unavailable - idp/i
const GROUP_RE =
  /group|forbidden|not (?:authorized|permitted|allowed)|missing permission|no longer (?:listed|valid)/i

/**
 * Map an API error string (and optional status) to operator-facing privileged-action copy.
 */
export function formatPrivilegedActionError(
  error: string | null | undefined,
  status?: number,
): PrivilegedActionError {
  const raw = (error ?? '').trim()
  if (status === 503 || DIRECTORY_RE.test(raw)) {
    return {
      kind: 'directory_unavailable',
      message:
        'Directory unavailable. Privileged actions need a live group check from the identity provider. Try again when the directory is reachable.',
    }
  }
  if (status === 403 || GROUP_RE.test(raw)) {
    return {
      kind: 'group_invalid',
      message:
        raw && !/^forbidden$/i.test(raw)
          ? `Group membership is no longer valid for this action. ${raw}`
          : 'Group membership is no longer valid for this action. Sign in again after your IdP groups are updated, or ask an administrator.',
    }
  }
  return {
    kind: 'other',
    message: raw || 'Privileged action failed',
  }
}
