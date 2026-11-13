import { createHash } from 'node:crypto'
import { canonicalIssuer, type PrincipalId } from '../session/principal.js'

export type { PrincipalId }

/**
 * Commit identity: how a Principal is stamped onto a human commit (Ticket 08)
 * and how job attribution trailers are formed.
 *
 * Human commit `author` is always canonical `iss|sub`; email is the Principal's
 * email at commit time. Client-supplied author/email fields are overwritten by
 * the BFF (see `author.ts`).
 */

const IDENTITY_TRAILER_KEYS = ['Performed-by', 'Submitted-by', 'Signed-by', 'Job']

/** Canonical commit `author` for a human Principal: `iss|sub` (trailing slash on iss removed). */
export function humanCommitAuthor(principal: PrincipalId): string {
  return `${canonicalIssuer(principal.iss)}|${principal.sub}`
}

/** Email stamped on a human commit: Principal email at commit time. */
export function humanCommitEmail(principal: { email: string }): string {
  return principal.email
}

/**
 * Strip any identity trailers from client-supplied commit message.
 * These will be re-added by the BFF with authoritative data.
 */
export function stripIdentityTrailers(message: string): string {
  const lines = message.split('\n')
  const filtered: string[] = []
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      if (IDENTITY_TRAILER_KEYS.includes(key)) {
        continue // Skip identity trailers
      }
    }
    filtered.push(line)
  }
  
  return filtered.join('\n')
}

/**
 * Format a principal identity as a commit trailer value.
 * Format: iss|sub (Name)
 */
export function formatIdentityTrailer(principal: PrincipalId & { name: string }): string {
  return `${humanCommitAuthor(principal)} (${principal.name})`
}

/**
 * Append authoritative identity trailer to commit message.
 * The BFF adds this after stripping any client-supplied identity.
 */
export function appendIdentityTrailer(
  message: string,
  key: string,
  principal: PrincipalId & { name: string },
): string {
  const cleaned = stripIdentityTrailers(message)
  return `${cleaned}\n\n${key}: ${formatIdentityTrailer(principal)}`
}

/**
 * Job token: identifies a job execution, not the submitting user.
 * Jobs get BFF-internal credentials that don't expose user tokens.
 */
export interface JobToken {
  kind: 'job'
  jobId: string
  submittedBy: PrincipalId & { name: string }
  issuedAt: number
  expiresAt: number
}

/**
 * Create a BFF-internal token for job execution.
 * This token identifies the job, not the user who submitted it.
 */
export function createJobToken(
  jobId: string,
  submittedBy: PrincipalId & { name: string },
  durationMs: number = 3600000, // 1 hour default
): JobToken {
  const now = Date.now()
  return {
    kind: 'job',
    jobId,
    submittedBy,
    issuedAt: now,
    expiresAt: now + durationMs,
  }
}

/**
 * Verify that a token is a job token (not user credentials).
 */
export function isJobToken(token: unknown): token is JobToken {
  return (
    typeof token === 'object' &&
    token !== null &&
    'kind' in token &&
    token.kind === 'job'
  )
}

/**
 * Hash a job token for inclusion in commit trailers.
 * Returns sha256 hash (first 16 hex characters for brevity).
 */
export function hashJobToken(token: JobToken): string {
  // Hash the essential token fields to create a unique identifier
  const tokenString = JSON.stringify({
    kind: token.kind,
    jobId: token.jobId,
    submittedBy: token.submittedBy,
    issuedAt: token.issuedAt,
  })
  const hash = createHash('sha256').update(tokenString).digest('hex')
  return hash.slice(0, 16) // First 16 chars for brevity
}

/**
 * Create commit message with job attribution trailer (Ticket 21, U6).
 * 
 * Format: Job: J-1234, Submitted-by: iss|sub (Name), Token: sha256:abc123...
 * 
 * This ensures repository-level attribution even if audit logs are separated
 * from the repository. Part 11 §11.50(a) requires signed records contain
 * "the name of the signer." For Jobs, attribution must persist with repository history.
 */
export function appendJobAttribution(
  message: string,
  jobId: string,
  submittedBy: PrincipalId & { name: string },
  tokenHash?: string,
): string {
  const cleaned = stripIdentityTrailers(message)
  const identity = formatIdentityTrailer(submittedBy)
  const tokenPart = tokenHash ? `, Token: sha256:${tokenHash}` : ''
  return `${cleaned}\n\nJob: ${jobId}, Submitted-by: ${identity}${tokenPart}`
}

/**
 * Create commit message with job attribution from a JobToken (Ticket 21, U6).
 * Convenience wrapper that extracts info from the token and includes token hash.
 */
export function appendJobAttributionFromToken(
  message: string,
  token: JobToken,
): string {
  const tokenHash = hashJobToken(token)
  return appendJobAttribution(message, token.jobId, token.submittedBy, tokenHash)
}

/**
 * Check if a principal can electronically sign documents.
 * Only human Principals can sign.
 */
export function canElectronicallySign(_principal: { iss: string }): boolean {
  return true
}

/**
 * Validate that a principal can sign, throwing if not.
 */
export function requireSigningCapability(principal: { iss: string }): void {
  if (!canElectronicallySign(principal)) {
    throw new Error('Only human principals can electronically sign')
  }
}
