import { immudbConfig, openLedger, type Ledger } from './auditLedger.js'

let ledger: Promise<Ledger> | undefined
let lastAppendError: string | null = null

export function ledgerOrOpen(): Promise<Ledger> {
  ledger ??= openLedger(immudbConfig())
  return ledger
}

/** Swaps the ledger (tests wrap the real one to inject faults). */
export function useAuditLedger(next: Ledger): void {
  ledger = Promise.resolve(next)
}

export function getLastAppendError(): string | null {
  return lastAppendError
}

export function setLastAppendError(err: string | null): void {
  lastAppendError = err
}
