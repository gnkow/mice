/** Days until a primary seal key is due for automatic normal rotation (Ticket 34). */
export const SEAL_KEY_ROTATION_DAYS = 30

export type SealKeyScheduleStatus = {
  /** Epoch seconds when the current primary was issued (schedule basis). */
  lastScheduledFrom: number
  /** Epoch seconds when automatic normal rotation becomes due. */
  nextEligibleAt: number
  /** True when now ≥ nextEligibleAt. */
  due: boolean
  /** One-line status for the accessible region. */
  summary: string
}

/**
 * Derive automatic rotation status from the current key's validFrom.
 * The process has no next-run / last-tick API; eligibility is keyed off issue time.
 */
export function decideSealKeyScheduleStatus(
  validFrom: number,
  nowSec = Math.floor(Date.now() / 1000),
): SealKeyScheduleStatus {
  const nextEligibleAt = validFrom + SEAL_KEY_ROTATION_DAYS * 24 * 60 * 60
  const due = nowSec >= nextEligibleAt
  const lastDay = new Date(validFrom * 1000).toISOString().slice(0, 10)
  const nextDay = new Date(nextEligibleAt * 1000).toISOString().slice(0, 10)
  const summary = due
    ? `Automatic normal rotation is due (30-day schedule from ${lastDay}). Next eligible: ${nextDay}.`
    : `Automatic normal rotation runs on a 30-day schedule from key issue (${lastDay}). Next eligible: ${nextDay}.`
  return {
    lastScheduledFrom: validFrom,
    nextEligibleAt,
    due,
    summary,
  }
}
