import type { AuditEvent } from './auditTypes.js'

let auditObserver: ((event: AuditEvent) => void) | undefined

export function setAuditObserver(observer: (event: AuditEvent) => void): void {
  auditObserver = observer
}

/** Notify the process observer; failures must not affect the durable journal. */
export function observeAuditEvent(event: AuditEvent): void {
  if (!auditObserver) return
  try {
    auditObserver(event)
  } catch (error) {
    // The journal remains durable; the notification worker retries projection.
    console.error('[mice-auth] notification capture failed; replay required', error)
  }
}
