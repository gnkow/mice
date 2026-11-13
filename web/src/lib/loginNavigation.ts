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

/** BFF authorize URL that always prompts for IdP credentials. */
export function ssoLoginHref(next: string): string {
  const safe = safeLoginReturnPath(next)
  if (!safe || safe === '/') return '/auth/login?prompt=login'
  return `/auth/login?prompt=login&next=${encodeURIComponent(safe)}`
}

/** Query string for Navigate → `/login` when a protected route is unauthenticated. */
export function loginRedirectSearch(location: string): string {
  if (!location || location === '/') return ''
  return `?next=${encodeURIComponent(location)}`
}
