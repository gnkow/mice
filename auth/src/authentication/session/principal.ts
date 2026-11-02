/**
 * Principal identity: the single place that knows how a Principal is keyed and matched
 * (ADR 0001). A Principal is an IdP `iss`+`sub`; email counts only when verified.
 */
export type PrincipalId = { sub: string; iss: string }

/** Issuers are compared and stored without a trailing slash, so `https://idp/` and `https://idp` are one Principal. */
export function canonicalIssuer(iss: string): string {
  return iss.trim().replace(/\/+$/, '')
}

/** Reserved issuer of service principals (`urn:mice:service|<uuid>`); never a valid OIDC issuer. */
export const SERVICE_ISSUER = 'urn:mice:service'

export type PrincipalKind = 'human' | 'service'

/** What a Principal may do, decided by kind in one place. */
export type Capability = 'canBeAdmin' | 'hasFavorites' | 'canOwnServicePrincipals'

const CAPABILITIES: Record<PrincipalKind, Record<Capability, boolean>> = {
  human: { canBeAdmin: true, hasFavorites: true, canOwnServicePrincipals: true },
  service: { canBeAdmin: false, hasFavorites: false, canOwnServicePrincipals: false },
}

export function kindOf(p: { iss: string }): PrincipalKind {
  return p.iss === SERVICE_ISSUER ? 'service' : 'human'
}

export function can(p: { iss: string }, capability: Capability): boolean {
  return CAPABILITIES[kindOf(p)][capability]
}

/** The identity a service principal authenticates as. */
export function serviceIdentity(id: string): PrincipalId {
  return { sub: id, iss: SERVICE_ISSUER }
}

/** True for a PAT minted with scopes: it never gets admin bypass, fine-grained grants or per-user routes. */
export function isScopedCredential(user: { patScopes?: readonly unknown[] }): boolean {
  return !!user.patScopes?.length
}

// PostgreSQL text cannot hold NUL, so keys use the ASCII unit separator.
const SEP = '\u001f'
const norm = (v: string) => v.trim().replace(/\/$/, '')

/** Canonical storage key for a Principal. */
export function principalKey(p: PrincipalId): string {
  return `${p.iss}${SEP}${p.sub}`
}

export function parsePrincipalKey(key: string): PrincipalId {
  const i = key.indexOf(SEP)
  if (i < 0) return { iss: '', sub: key }
  return { iss: key.slice(0, i), sub: key.slice(i + 1) }
}

/**
 * Match a bootstrap list entry against a Principal. Entries are either `<iss>|<sub>` or an
 * email; an email matches only when the IdP asserted `email_verified`. A bare `sub`, or the
 * synthetic `<sub>@users.local` fallback, never matches.
 */
export function matchesIdentityEntry(
  entry: string,
  user: PrincipalId & { email: string; emailVerified?: boolean },
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
