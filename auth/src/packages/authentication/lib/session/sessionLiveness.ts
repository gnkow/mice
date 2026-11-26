/**
 * Web Session idle + absolute lifetime (Ticket 03 / #21).
 *
 * Pure allow/refuse so loadSession and list routes share one policy.
 */

export type SessionLivenessInput = {
  now: number
  sessionStart: number
  lastActive: number
  /** Absolute lifetime from sessionStart (seconds). */
  ttlSec: number
  /** Idle timeout from lastActive; 0 disables idle expiry. */
  idleSec: number
}

export type SessionLiveness =
  | { alive: true }
  | { alive: false; reason: 'absolute' | 'idle' }

/** Decide whether a Web Session row is still usable at `now`. */
export function decideSessionLiveness(input: SessionLivenessInput): SessionLiveness {
  if (input.now >= input.sessionStart + input.ttlSec) {
    return { alive: false, reason: 'absolute' }
  }
  if (input.idleSec > 0 && input.now - input.lastActive > input.idleSec) {
    return { alive: false, reason: 'idle' }
  }
  return { alive: true }
}
