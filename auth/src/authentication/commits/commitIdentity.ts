import { kindOf, type PrincipalId } from '../session/principal.js'

/**
 * TICKET 08: Commit Identity and Job Tokens
 * 
 * Ensures commit attribution is cryptographically trustworthy:
 * - Strips client-supplied identity trailers
 * - BFF appends authoritative iss+sub + name snapshot
 * - Jobs use BFF-internal tokens, not user credentials
 * - Electronic signatures restricted to humans only
 */

const IDENTITY_TRAILER_KEYS = ['Performed-by', 'Submitted-by', 'Signed-by']

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
  return `${principal.iss}|${principal.sub} (${principal.name})`
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
 * Create commit message with job attribution.
 * Shows both the submitter and the job that performed the action.
 */
export function appendJobAttribution(
  message: string,
  jobId: string,
  submittedBy: PrincipalId & { name: string },
): string {
  let result = stripIdentityTrailers(message)
  result += `\n\nSubmitted-by: ${formatIdentityTrailer(submittedBy)}`
  result += `\nPerformed-by: Job ${jobId}`
  return result
}

/**
 * Check if a principal can electronically sign documents.
 * Only humans can sign; service principals and jobs cannot.
 */
export function canElectronicallySign(principal: { iss: string }): boolean {
  return kindOf(principal) === 'human'
}

/**
 * Validate that a principal can sign, throwing if not.
 */
export function requireSigningCapability(principal: { iss: string }): void {
  if (!canElectronicallySign(principal)) {
    throw new Error('Only human principals can electronically sign')
  }
}
