/**
 * Web login tracer navigation (Ticket 02).
 *
 * Return-path sanitization and SSO href construction for the login page and
 * RequireAuth gate. Keeps unsafe / open-redirect targets out of the IdP round-trip.
 */

/** Same-site relative return path, or `/` when missing/unsafe/login. */
export function safeLoginReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/login')) return '/'
  return raw
}

export type LoginNavigation = {
  /** Sanitized same-site return path for after IdP (defaults to `/`). */
  returnPath: string
  /** BFF authorize URL that always prompts for IdP credentials. */
  ssoHref: string
  /** Query string for Navigate → `/login` when a protected route is unauthenticated. */
  redirectSearch: string
}

/**
 * One navigation decision for login page + RequireAuth gate.
 * Callers pass `next` (page) and/or `location` (gate); unsafe targets collapse to `/`.
 */
export function decideLoginNavigation(input: {
  next?: string | null
  location?: string | null
}): LoginNavigation {
  const returnPath = safeLoginReturnPath(input.next)
  const ssoHref =
    returnPath === '/'
      ? '/auth/login?prompt=login'
      : `/auth/login?prompt=login&next=${encodeURIComponent(returnPath)}`
  const location = input.location ?? ''
  const redirectSearch =
    !location || location === '/' ? '' : `?next=${encodeURIComponent(location)}`
  return { returnPath, ssoHref, redirectSearch }
}

/** BFF authorize URL that always prompts for IdP credentials. */
export function ssoLoginHref(next: string): string {
  return decideLoginNavigation({ next }).ssoHref
}

/** Query string for Navigate → `/login` when a protected route is unauthenticated. */
export function loginRedirectSearch(location: string): string {
  return decideLoginNavigation({ location }).redirectSearch
}
