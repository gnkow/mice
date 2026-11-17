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

/**
 * Build `/auth/reauth` Continue target. Prefer the in-app page (`resumePath`) as
 * `next` — the BFF’s `reauthUrl` often points `next` at the API path that
 * challenged (e.g. `/auth/sign/execute`), which `safeReauthReturnPath` rejects
 * and drops the user on `/`. Keep the server’s `max_age` when present.
 */
function reauthContinueUrl(
  body: Record<string, unknown>,
  resumePath: string,
): string {
  const next = encodeURIComponent(resumePath || '/')
  const raw = typeof body.reauthUrl === 'string' ? body.reauthUrl.trim() : ''
  if (raw) {
    try {
      const u = new URL(raw, 'http://local.invalid')
      if (u.pathname === '/auth/reauth') {
        const maxAge = u.searchParams.get('max_age') ?? '60'
        return `/auth/reauth?max_age=${encodeURIComponent(maxAge)}&next=${next}`
      }
    } catch {
      // fall through to default
    }
  }
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
        'This signature needs a fresh sign-in from the last minute. Confirm it is still you — the same account — then try again.',
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
      message: `Electronic signatures need verified multi-factor authentication.${evidenceHint} Continue to sign in again with your organisation MFA (for example an authenticator OTP), then retry.`,
      continueUrl: reauthContinueUrl(record, resumePath),
      ...(EVIDENCE_REASONS.has(reason) ? { evidenceReason: reason } : {}),
    }
  }

  return null
}

/**
 * Client-side gate before prepare/execute: session has no MFA evidence on the
 * current IdP sign-in. Same interstitial as an API `amr_missing` / MFA refusal.
 */
export function mfaRequiredChallenge(resumePath?: string): SigningChallenge {
  const path =
    resumePath ??
    (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')
  return {
    kind: 'mfa_required',
    title: 'MFA required',
    message:
      'Electronic signatures need verified multi-factor authentication. Your current sign-in does not evidence MFA. Continue to sign in again with your organisation MFA (for example an authenticator OTP), then retry.',
    continueUrl: reauthContinueUrl({}, path),
  }
}
