/**
 * Login refuse / IdP status surfaces (tickets 04, 32, 38).
 *
 * Stable `?status=` codes from the auth callback redirect. Body copy matches the
 * BFF refuse messages so LoginPage never invents a second wording. Titles and
 * recovery hints are page chrome only.
 */

export const LOGIN_STATUS_CODES = [
  'disabled',
  'missing',
  'empty_name',
  'unreachable',
  'rate_limited',
] as const

export type LoginStatusCode = (typeof LOGIN_STATUS_CODES)[number]

export type LoginStatusSurface = {
  code: LoginStatusCode
  /** Visible heading inside the alert (not orphan body text). */
  title: string
  message: string
  /** Short next-step guidance under the BFF message. */
  hint: string
  /** Visual tone; unreachable is a service outage, others are account refuses. */
  tone: 'error' | 'warn'
}

const SURFACES: Record<LoginStatusCode, Omit<LoginStatusSurface, 'code'>> = {
  disabled: {
    title: 'Account disabled',
    message: 'Your account has been disabled by the administrator.',
    hint: 'Ask your organisation administrator to restore access, then try again.',
    // Same chrome as unreachable: soft warn panel, not a hard form-error flash.
    tone: 'warn',
  },
  missing: {
    title: 'Account not found',
    message: 'Your account was not found in the directory.',
    hint: 'Ask your organisation administrator to provision your account in the identity directory.',
    tone: 'warn',
  },
  empty_name: {
    title: 'Display name required',
    message: 'Your account has no name in the identity provider.',
    hint: 'Update your display name in the identity provider, then sign in again.',
    tone: 'warn',
  },
  unreachable: {
    title: 'Identity provider unavailable',
    message: 'IdP is unreachable. Login cannot be verified at this time.',
    hint: 'Wait a few minutes and try again. If this continues, contact your administrator.',
    tone: 'warn',
  },
  rate_limited: {
    title: 'Too many attempts',
    message:
      'Too many sign-in attempts from this network. Wait about a minute, then try again.',
    hint: 'You can keep this page open and retry with SSO after a short wait.',
    tone: 'warn',
  },
}

function isLoginStatusCode(raw: string): raw is LoginStatusCode {
  return (LOGIN_STATUS_CODES as readonly string[]).includes(raw)
}

/** Map a `?status=` query value to a titled alert surface, or null when unknown/absent. */
export function decideLoginStatus(
  raw: string | null | undefined,
): LoginStatusSurface | null {
  if (!raw || !isLoginStatusCode(raw)) return null
  return { code: raw, ...SURFACES[raw] }
}

/** Query string that lands the user on LoginPage with a refuse/outage surface. */
export function loginStatusSearch(code: LoginStatusCode): string {
  return `?status=${encodeURIComponent(code)}`
}
