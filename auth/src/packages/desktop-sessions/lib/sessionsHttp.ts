import type { Context } from 'hono'
import { changeCaptureResponse } from '../../authentication/session.js'

/** Map a sessions domain error to a JSON response (or change-capture refusal). */
export function sessionErrorResponse(err: unknown, c: Context, fallback: string) {
  const refused = changeCaptureResponse(err, c)
  if (refused) return refused
  const explicit =
    err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 0
  const msg = err instanceof Error ? err.message : fallback
  const status =
    explicit ||
    (/Forbidden|requires repository/i.test(msg) ? 403 : 400)
  const holder =
    err && typeof err === 'object' && 'holder' in err
      ? (err as { holder: unknown }).holder
      : undefined
  return c.json(
    { error: msg, ...(holder ? { holder } : {}) },
    status as 400 | 403 | 404 | 409 | 423 | 503 | 504,
  )
}
