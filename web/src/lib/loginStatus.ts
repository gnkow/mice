/**
 * Login refuse / IdP status surfaces (tickets 04, 32, 38).
 *
 * Stable `?status=` codes from the auth callback redirect. Copy matches the BFF
 * refuse messages so LoginPage never invents a second wording.
 */

export const LOGIN_STATUS_CODES = [
  'disabled',
  'missing',
  'empty_name',
  'unreachable',
] as const

export type LoginStatusCode = (typeof LOGIN_STATUS_CODES)[number]

export type LoginStatusSurface = {
  code: LoginStatusCode
  /** Visible heading inside the alert (not orphan body text). */
  title: string
  message: string
  /** Visual tone; unreachable is a service outage, others are account refuses. */
  tone: 'error' | 'warn'
}

const SURFACES: Record<LoginStatusCode, Omit<LoginStatusSurface, 'code'>> = {
  disabled: {
    title: 'Sign-in refused',
    message: 'Your account has been disabled by the administrator.',
    tone: 'error',
  },
  missing: {
    title: 'Sign-in refused',
    message: 'Your account was not found in the directory.',
    tone: 'error',
  },
  empty_name: {
    title: 'Sign-in refused',
    message: 'Your account has no name in the identity provider.',
    tone: 'error',
  },
  unreachable: {
    title: 'Identity provider unavailable',
    message: 'IdP is unreachable. Login cannot be verified at this time.',
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
