import { api } from './api.mjs'

/** Every mutation of a dataset or of access needs a reason; the BFF rejects it with 400 otherwise. */
export const REASON_HEADER = 'x-mice-reason'

const REASON_HINT =
  'Pass --reason "<why you are making this change>" (or write a longer commit message).'

/**
 * Removes `--reason <text>` / `--reason=<text>` from argv.
 * @param {string[]} argv
 * @returns {{ args: string[], reason: string | undefined }}
 */
export function extractReason(argv) {
  const args = []
  let reason
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reason') {
      const v = argv[i + 1]
      if (v == null || v.startsWith('--')) throw new Error('--reason needs a value')
      reason = v
      i++
    } else if (a.startsWith('--reason=')) {
      reason = a.slice('--reason='.length)
    } else args.push(a)
  }
  return { args, reason }
}

/** @param {string} method @param {string | undefined} reason */
export function reasonHeaders(method, reason) {
  if (!reason || method === 'GET' || method === 'HEAD') return {}
  return { [REASON_HEADER]: reason }
}

/**
 * Message for a failed BFF call. Handles both error shapes: BFF-native `{ error, code }` and the
 * oxen-shaped `{ status_message, error: { detail } }` the proxy returns.
 * @param {number} status @param {unknown} body @param {string} [statusText]
 */
export function explainApiError(status, body, statusText = '') {
  let detail = statusText
  let code
  if (typeof body === 'string') detail = body || statusText
  else if (body && typeof body === 'object') {
    const b = /** @type {Record<string, any>} */ (body)
    code = typeof b.code === 'string' ? b.code : b.status_message
    if (typeof b.error === 'string') detail = b.error
    else if (b.error && typeof b.error.detail === 'string') detail = b.error.detail
  }
  const base = `${status}: ${detail}`
  return code === 'reason_required' || code === 'reason_too_short' ? `${base}\n${REASON_HINT}` : base
}

/**
 * oxen cannot send a header, so the reason is declared once and applies to the caller's next
 * mutations for a short time.
 * @param {string} remote @param {string} token @param {string} reason
 */
export async function declareReason(remote, token, reason) {
  return api(remote, token, '/auth/reason', {
    method: 'POST',
    body: JSON.stringify({ reason, ttlSec: 900 }),
  })
}
