import type { SessionUser } from './session.js'

const norm = (v: string) => v.trim().replace(/\/$/, '')

/**
 * Match a bootstrap list entry against a Principal. Entries are either `<iss>|<sub>` or an
 * email; an email matches only when the IdP asserted `email_verified`. A bare `sub`, or the
 * synthetic `<sub>@users.local` fallback, never matches.
 */
export function matchesIdentityEntry(
  entry: string,
  user: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'emailVerified'>,
): boolean {
  const e = entry.trim()
  if (!e) return false
  const bar = e.lastIndexOf('|')
  if (bar >= 0) {
    return norm(e.slice(0, bar)) === norm(user.iss) && e.slice(bar + 1) === user.sub
  }
  if (!e.includes('@')) return false
  const email = user.email.toLowerCase()
  if (email.endsWith('@users.local')) return false
  return user.emailVerified === true && e.toLowerCase() === email
}
