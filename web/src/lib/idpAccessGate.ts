/**
 * Live IdP gate surfaces for authenticated-request failures (ticket 19).
 * Shown by RequireAuth when /auth/me returns 503/403 instead of a blank shell.
 */

export type IdpAccessGateKind = 'unavailable' | 'refused'

export type IdpAccessGate = {
  kind: IdpAccessGateKind
  status: 503 | 403
  title: string
  message: string
  tone: 'error' | 'warn'
}

/** Map /auth/me IdP/access denials to a titled alert. */
export function decideIdpAccessGate(
  status: number,
  error?: string | null,
): IdpAccessGate | null {
  if (status === 503) {
    return {
      kind: 'unavailable',
      status: 503,
      title: 'Identity provider unavailable',
      message:
        error?.trim() ||
        'Your account could not be verified with the identity provider. Try again shortly, or contact an administrator if this continues.',
      tone: 'warn',
    }
  }
  if (status === 403) {
    return {
      kind: 'refused',
      status: 403,
      title: 'Access refused',
      message:
        error?.trim() ||
        'Your account is not allowed to use Mice right now. Contact an administrator if you believe this is a mistake.',
      tone: 'error',
    }
  }
  return null
}
