import type { SessionUser } from '../session/session.js'

/**
 * Idle timeout at signing (Ticket 20 / Round 8 U2).
 *
 * "Idle" = no authenticated HTTP activity within sessionIdleSec (default 900).
 * Signing prepare/execute refuse when lastActive is outside that window.
 */

export type SigningIdleDecision =
  | { allowed: true }
  | {
      allowed: false
      idleSec: number
      maxIdleSec: number
      idleMinutes: number
      maxIdleMinutes: number
      message: string
    }

/**
 * Decide whether a Session is still active enough for the signing ceremony.
 * sessionIdleSec ≤ 0 disables the check; missing lastActive skips it.
 */
export function evaluateSigningIdle(input: {
  lastActive: number | undefined
  sessionIdleSec: number
  nowSec: number
}): SigningIdleDecision {
  if (input.sessionIdleSec <= 0) return { allowed: true }
  if (input.lastActive === undefined) return { allowed: true }

  const idleSec = input.nowSec - input.lastActive
  if (idleSec <= input.sessionIdleSec) return { allowed: true }

  const idleMinutes = Math.floor(idleSec / 60)
  const maxIdleMinutes = Math.floor(input.sessionIdleSec / 60)
  return {
    allowed: false,
    idleSec,
    maxIdleSec: input.sessionIdleSec,
    idleMinutes,
    maxIdleMinutes,
    message: `Session idle for ${idleMinutes}+ minutes, re-authenticate required`,
  }
}

/** Map an idle refusal to the signing HTTP response, or null when signing may proceed. */
export function checkSigningIdleTimeout(
  user: Pick<SessionUser, 'lastActive'>,
  sessionIdleSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): Response | null {
  const decision = evaluateSigningIdle({
    lastActive: user.lastActive,
    sessionIdleSec,
    nowSec,
  })
  if (decision.allowed) return null
  return Response.json(
    {
      error: 'session_idle',
      message: decision.message,
      idleMinutes: decision.idleMinutes,
      maxIdleMinutes: decision.maxIdleMinutes,
    },
    { status: 401 },
  )
}
