import type { LedgerVerification } from './auditLedger.js'

/** Result of the last ledger proof walk, remembered for readiness and mutation gating. */
export type AuditVerification = LedgerVerification

export type AuditBreakAck = { seq: number; reason: string }

/**
 * In-memory chain-gate: last verification plus whether that break has been acknowledged.
 * Dataset mutations are refused while {@link AuditChainGate.isBlocked} is true.
 */
export type AuditChainGate = {
  /** Remembers a fresh verification result (ok or break). */
  recordVerification(v: AuditVerification): void
  /**
   * True while the last verification failed and the operator has not acknowledged that same
   * break. A different or later break blocks again.
   */
  isBlocked(): boolean
  /** Acknowledges the current break; null when the trail is intact or never verified. */
  acknowledge(): AuditBreakAck | null
  /** Last recorded verification, or null before the first verify. */
  current(): AuditVerification | null
}

/** Pure gate state — unit-testable without opening the ledger. */
export function createAuditChainGate(): AuditChainGate {
  let lastVerification: AuditVerification | null = null
  let acknowledged: AuditBreakAck | null = null

  return {
    recordVerification(v) {
      lastVerification = v
    },
    isBlocked() {
      const v = lastVerification
      if (!v || v.ok) return false
      return !(
        acknowledged &&
        acknowledged.seq === v.firstBreak.seq &&
        acknowledged.reason === v.firstBreak.reason
      )
    },
    acknowledge() {
      const v = lastVerification
      if (!v || v.ok) return null
      acknowledged = { seq: v.firstBreak.seq, reason: v.firstBreak.reason }
      return acknowledged
    },
    current() {
      return lastVerification
    },
  }
}

/** Process-wide gate used by verify / acknowledge / readiness. */
export const auditChainGate = createAuditChainGate()
