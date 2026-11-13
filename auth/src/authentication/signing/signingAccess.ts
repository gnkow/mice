import type { Context } from 'hono'
import { env } from '../../env.js'
import { reauthenticate } from '../oidc/stepUp.js'
import type { SessionUser } from '../session/session.js'
import { checkSigningIdleTimeout } from './idleTimeout.js'

/** Signing ceremony step-up window (Ticket 09 / story 9). */
export const SIGNING_STEP_UP_MAX_AGE_SEC = 60

export type SigningAccessResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: Response }

/**
 * Shared signing-route gate: fresh step-up (60s) then idle refusal.
 * HTTP adapters stay thin; tests can override clocks and idle window.
 */
export async function requireSigningAccess(
  c: Context,
  user: SessionUser,
  opts?: {
    freshnessSec?: number
    sessionIdleSec?: number
    nowSec?: number
  },
): Promise<SigningAccessResult> {
  const stepUp = await reauthenticate(c, opts?.freshnessSec ?? SIGNING_STEP_UP_MAX_AGE_SEC)
  if (!stepUp.ok) return stepUp
  const idle = checkSigningIdleTimeout(
    user,
    opts?.sessionIdleSec ?? env.sessionIdleSec,
    opts?.nowSec ?? Math.floor(Date.now() / 1000),
  )
  if (idle) return { ok: false, response: idle }
  return { ok: true, user: stepUp.user }
}
