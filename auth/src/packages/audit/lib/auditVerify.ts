import { auditChainGate, type AuditVerification } from './auditChainGate.js'
import {
  auditReadiness as runAuditReadiness,
  type AuditReadiness,
} from './auditReadiness.js'
import { currentClock } from '../../shared/index.js'
import { getLastAppendError, ledgerOrOpen } from './auditLedgerHandle.js'

/**
 * True while the last verification failed and the operator has not acknowledged that same
 * break. Dataset mutations are refused meanwhile. A different or later break blocks again.
 */
export function auditChainBlocked(): boolean {
  return auditChainGate.isBlocked()
}

/** Walks the ledger's proofs and remembers the result for readiness. */
export async function verifyAudit(): Promise<AuditVerification> {
  let result: AuditVerification
  try {
    result = await (await ledgerOrOpen()).verify()
  } catch (err) {
    result = {
      ok: false,
      events: 0,
      verifiedAt: new Date(currentClock.now()).toISOString(),
      firstBreak: { seq: 0, reason: `audit store unreadable: ${String(err)}` },
    }
  }
  auditChainGate.recordVerification(result)
  return result
}

/** Re-verifies and acknowledges the current break; null when the trail is intact. Held in memory, so a restart asks again. */
export async function acknowledgeAuditBreak(): Promise<{ seq: number; reason: string } | null> {
  await verifyAudit()
  return auditChainGate.acknowledge()
}

/** Cheap: pings the ledger and reads the last verification; never walks the proofs. */
export function auditReadiness(): Promise<AuditReadiness> {
  return runAuditReadiness({
    lastAppendError: () => getLastAppendError(),
    health: async () => (await ledgerOrOpen()).health(),
    currentVerification: () => auditChainGate.current(),
    isChainBlocked: () => auditChainBlocked(),
  })
}

/** Boot check: connects to the ledger (creating its database on first use) and verifies it. */
export async function initAudit(): Promise<AuditVerification> {
  await ledgerOrOpen()
  return verifyAudit()
}

export type { AuditVerification, AuditReadiness }
