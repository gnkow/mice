import { askReason, summarizeMutation, type ReasonSubmission } from './reasonPrompt'

/** Carries the reason for a change; the BFF requires one on update/delete and privileged mutations. */
export const REASON_HEADER = 'X-Mice-Reason'
export const REASON_CATEGORY_HEADER = 'X-Mice-Reason-Category'
export const CHANGE_CONTROL_HEADER = 'X-Mice-Change-Control-Id'
export const SIGNATURE_HEADER = 'X-Mice-Signature-Id'

const CEREMONY_CODES = new Set([
  'reason_required',
  'reason_too_short',
  'reason_category_required',
  'reason_category_invalid',
  'signature_required',
  'signature_invalid',
])

export type AskReasonFn = (input: {
  detail: string
  changeSummary: string
  method: string
  path: string
  body?: unknown
}) => Promise<ReasonSubmission | null> | ReasonSubmission | null

async function rejectionDetail(res: Response): Promise<string | null> {
  if (res.status !== 400) return null
  try {
    const body = (await res.clone().json()) as {
      code?: string
      status_message?: string
      error?: string | { detail?: string }
    }
    if (!CEREMONY_CODES.has(body.code ?? body.status_message ?? '')) return null
    return typeof body.error === 'string' ? body.error : (body.error?.detail ?? 'A signature is required')
  } catch {
    return null
  }
}

function parseJsonBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== 'string') return undefined
  try {
    return JSON.parse(init.body) as unknown
  } catch {
    return undefined
  }
}

/**
 * Runs a mutating request; when the BFF rejects it for a missing reason or signature,
 * opens the signing ceremony and retries with reason headers + signature id.
 */
export async function withReason(
  send: (submission?: ReasonSubmission) => Promise<Response>,
  options?: {
    ask?: AskReasonFn
    changeSummary?: string
    method?: string
    path?: string
    body?: unknown
    init?: RequestInit
  },
): Promise<Response> {
  const res = await send()
  const detail = await rejectionDetail(res)
  if (detail === null) return res
  const method = (options?.method ?? options?.init?.method ?? 'POST').toUpperCase()
  const path = options?.path ?? '/'
  const body = options?.body ?? parseJsonBody(options?.init)
  const ask = options?.ask ?? ((input) => askReason(input))
  const submission = await ask({
    detail,
    changeSummary: options?.changeSummary ?? summarizeMutation(method, path),
    method,
    path,
    body,
  })
  if (!submission?.reason.trim() || !submission.category || !submission.signatureId) {
    return res
  }
  return send({
    reason: submission.reason.trim(),
    category: submission.category,
    signatureId: submission.signatureId,
    ...(submission.changeControlId?.trim()
      ? { changeControlId: submission.changeControlId.trim() }
      : {}),
  })
}

export { summarizeMutation }
export type { ReasonSubmission }
