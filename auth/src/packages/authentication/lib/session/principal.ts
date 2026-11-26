/**
 * Principal identity: the single place that knows how a Principal is keyed and matched
 * (ADR 0001). A Principal is an IdP `iss`+`sub`; email counts only when verified.
 */
export type PrincipalId = { sub: string; iss: string }

/** Fine-grained CLI credential resource scope. */
export type CliCredentialScope = {
  namespace: string
  /** Omit = all repos in namespace. */
  repo?: string
  maxRole: 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}

/** Authenticated caller carried on the request (Session or CLI credential). */
export type SessionUser = {
  sub: string
  iss: string
  /** Internal Principal id, present once the user has a Session or a stored Principal. */
  principalId?: number
  email: string
  /** True only when the IdP asserted `email_verified`. */
  emailVerified?: boolean
  name: string
  /** OIDC id_token for RP-initiated logout (optional). */
  idToken?: string
  /** IdP group binding keys (`iss|group_id`), matched against recorded grants. */
  groups?: string[]
  /** True when session groups include name-based fallback keys (IdP gave no object ids). */
  groupsNameBasedFallback?: boolean
  /**
   * Fine-grained PAT resource scopes (Phase 2). Empty/undefined = full user
   * effective access. Never exceeds the user's grants.
   */
  patScopes?: CliCredentialScope[]
  /** Epoch seconds of the IdP authentication (id_token `auth_time`), if provided. */
  authTime?: number
  /** Epoch seconds the Session was first issued (absolute TTL anchor). */
  sessionStart?: number
  /** Epoch seconds of the last activity re-seal (idle timeout anchor). */
  lastActive?: number
}

/** Issuers are compared and stored without a trailing slash, so `https://idp/` and `https://idp` are one Principal. */
export function canonicalIssuer(iss: string): string {
  return iss.trim().replace(/\/+$/, '')
}

export type PrincipalKind = 'human'

/** Retired service-principal issuer; never a caller (issue 42). */
export const SERVICE_ISSUER = 'urn:mice:service'

/** What a Principal may do, decided by kind in one place. */
export type Capability = 'canBeAdmin' | 'hasFavorites'

const CAPABILITIES: Record<PrincipalKind, Record<Capability, boolean>> = {
  human: { canBeAdmin: true, hasFavorites: true },
}

/** A Principal is a person. Mice does not classify a service kind. */
export function kindOf(_p: { iss: string }): PrincipalKind {
  return 'human'
}

/**
 * True when the credential's issuer is the retired service-principal issuer.
 * Kind stays `human`; refusal as a caller lives here so authenticate does not
 * re-encode the issuer string.
 */
export function isServiceCaller(p: { iss: string }): boolean {
  return canonicalIssuer(p.iss) === SERVICE_ISSUER
}

export type ServiceCallerAdmission =
  | { allow: true }
  | { allow: false; status: 401; error: 'Authentication required' }

/**
 * Deep seam for authenticate: admit a human caller, or refuse `urn:mice:service`.
 * Session and bearer paths share this decision so issuer refusal lives once.
 */
export function decideServiceCallerAdmission(p: { iss: string }): ServiceCallerAdmission {
  if (isServiceCaller(p)) {
    return { allow: false, status: 401, error: 'Authentication required' }
  }
  return { allow: true }
}

export function can(p: { iss: string }, capability: Capability): boolean {
  return CAPABILITIES[kindOf(p)][capability]
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


/** Same string written into oxen commit `author` for a Principal. */
export function signerAuthorKey(signer: { iss: string; sub: string }): string {
  return `${canonicalIssuer(signer.iss)}|${signer.sub}`
}

/**
 * Normalize AuthZ `iss\\u001fsub` keys and commit `iss|sub` authors to the same
 * comparison form used for the merge signer.
 */
export function normalizePrincipalAuthorKey(raw: string): string {
  const trimmed = raw.trim()
  const us = trimmed.indexOf('\u001f')
  if (us > 0 && us < trimmed.length - 1) {
    return signerAuthorKey({ iss: trimmed.slice(0, us), sub: trimmed.slice(us + 1) })
  }
  const bar = trimmed.indexOf('|')
  if (bar > 0 && bar < trimmed.length - 1) {
    return signerAuthorKey({ iss: trimmed.slice(0, bar), sub: trimmed.slice(bar + 1) })
  }
  return trimmed
}
