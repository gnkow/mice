/** Carries the reason for a change; the BFF requires one on every dataset or access mutation. */
export const REASON_HEADER = 'X-Mice-Reason'

const REASON_CODES = new Set(['reason_required', 'reason_too_short'])

function defaultAsk(detail: string): string | null {
  if (typeof window === 'undefined') return null
  return window.prompt(`Reason for this change (recorded in the audit trail)\n\n${detail}`)
}

async function rejectionDetail(res: Response): Promise<string | null> {
  if (res.status !== 400) return null
  try {
    const body = (await res.clone().json()) as {
      code?: string
      status_message?: string
      error?: string | { detail?: string }
    }
    if (!REASON_CODES.has(body.code ?? body.status_message ?? '')) return null
    return typeof body.error === 'string' ? body.error : (body.error?.detail ?? 'A reason is required')
  } catch {
    return null
  }
}

/**
 * Runs a mutating request; when the BFF rejects it for a missing or too-short reason, asks the
 * user for one and sends it again with the reason attached. The server stays the only judge of
 * what counts as a valid reason.
 */
export async function withReason(
  send: (reason?: string) => Promise<Response>,
  ask: (detail: string) => string | null = defaultAsk,
): Promise<Response> {
  const res = await send()
  const detail = await rejectionDetail(res)
  if (detail === null) return res
  const reason = ask(detail)?.trim()
  if (!reason) return res
  return send(reason)
}
