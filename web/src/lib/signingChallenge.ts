/** Signing-ceremony challenges that need an in-app interstitial (tickets 09 / 20 / 52). */

export type SigningChallengeKind = 'step_up' | 'session_idle' | 'mfa_required'

export type SigningChallenge = {
  kind: SigningChallengeKind
  /** Dialog title shown before any redirect. */
  title: string
  /** Announced (role=alert) recovery copy. */
  message: string
  /** When set, Continue navigates here instead of a silent redirect. */
  continueUrl: string | null
  /** Ticket 52 evidence refusal reason, when the API provided one. */
  evidenceReason?: string
}

const EVIDENCE_REASONS = new Set([
  'unverifiable',
  'auth_time_missing',
  'auth_time_stale',
  'acr_missing',
  'amr_missing',
  'weak_mfa',
])

function reauthContinueUrl(
  body: Record<string, unknown>,
  resumePath: string,
): string {
  if (typeof body.reauthUrl === 'string' && body.reauthUrl.trim()) {
    return body.reauthUrl.trim()
  }
  const next = encodeURIComponent(resumePath || '/')
  return `/auth/reauth?max_age=60&next=${next}`
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

/**
 * Maps signing / access-review API refusals to a titled interstitial.
 * Returns null when the response is not a known ceremony challenge.
 */
export function classifySigningChallenge(
  status: number,
  body: unknown,
  opts?: { resumePath?: string },
): SigningChallenge | null {
  const record = asRecord(body)
  const error = typeof record.error === 'string' ? record.error : ''
  const reason = typeof record.reason === 'string' ? record.reason : ''
  const message = typeof record.message === 'string' ? record.message : ''
  const resumePath = opts?.resumePath ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')
  const hasReauthUrl = typeof record.reauthUrl === 'string' && record.reauthUrl.trim().length > 0

  if (
    status === 401 &&
    (error === 'reauthentication_required' || hasReauthUrl)
  ) {
    return {
      kind: 'step_up',
      title: "Confirm it's you",
      message:
        'This signature needs a fresh sign-in from the last minute. Continue to confirm it is you, then try again.',
      continueUrl: reauthContinueUrl(record, resumePath),
    }
  }

  if (status === 401 && error === 'session_idle') {
    return {
      kind: 'session_idle',
      title: 'Session idle',
      message:
        message ||
        'Your session has been idle too long to sign. Continue to sign in again, then retry the signature.',
      continueUrl: reauthContinueUrl(record, resumePath),
    }
  }

  if (
    (status === 403 || status === 401) &&
    (error === 'MFA required for electronic signature' ||
      EVIDENCE_REASONS.has(reason) ||
      /mfa/i.test(error))
  ) {
    const evidenceHint = EVIDENCE_REASONS.has(reason)
      ? ` Missing or incomplete evidence (${reason.replace(/_/g, ' ')}).`
      : ''
    return {
      kind: 'mfa_required',
      title: 'MFA required',
      message: `Electronic signatures need verified multi-factor authentication.${evidenceHint} Continue to complete MFA, then try again.`,
      continueUrl: reauthContinueUrl(record, resumePath),
      ...(EVIDENCE_REASONS.has(reason) ? { evidenceReason: reason } : {}),
    }
  }

  return null
}
