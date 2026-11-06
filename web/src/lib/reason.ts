import { askReason, summarizeMutation, type ReasonSubmission } from './reasonPrompt'

/** Carries the reason for a change; the BFF requires one on update/delete and privileged mutations. */
export const REASON_HEADER = 'X-Mice-Reason'
export const REASON_CATEGORY_HEADER = 'X-Mice-Reason-Category'
export const CHANGE_CONTROL_HEADER = 'X-Mice-Change-Control-Id'

const REASON_CODES = new Set([
  'reason_required',
  'reason_too_short',
  'reason_category_required',
  'reason_category_invalid',
  'change_control_required',
  'change_control_invalid',
])

export type AskReasonFn = (input: {
  detail: string
  changeSummary: string
}) => Promise<ReasonSubmission | null> | ReasonSubmission | null

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
 * Runs a mutating request; when the BFF rejects it for a missing/invalid reason, opens the
 * reason dialog (category + free text) and retries with both headers. The server stays the only
 * judge of what counts as valid.
 */
export async function withReason(
  send: (submission?: ReasonSubmission) => Promise<Response>,
  options?: {
    ask?: AskReasonFn
    /** Override for the “what will change” line; defaults to method + path when provided by callers. */
    changeSummary?: string
  },
): Promise<Response> {
  const res = await send()
  const detail = await rejectionDetail(res)
  if (detail === null) return res
  const ask = options?.ask ?? ((input) => askReason(input))
  const submission = await ask({
    detail,
    changeSummary: options?.changeSummary ?? 'This change',
  })
  if (!submission?.reason.trim() || !submission.category || !submission.changeControlId.trim()) {
    return res
  }
  return send({
    reason: submission.reason.trim(),
    category: submission.category,
    changeControlId: submission.changeControlId.trim(),
  })
}

export { summarizeMutation }
export type { ReasonSubmission }
