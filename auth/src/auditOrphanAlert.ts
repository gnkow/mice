import { orphanIntents, type AuditEvent } from './audit.js'
import { listInstanceAdmins } from './authzInstanceStore.js'
import type { UserKey } from './authzTypes.js'
import { currentClock } from './clock.js'
import { env } from './env.js'
import { emitNotification } from './notifications.js'
import type { NotificationEvent } from './notificationsTypes.js'

/** Unpaired Intents whose timestamp is older than `thresholdMs` at `now`. */
export function agedOrphanIntents(
  events: AuditEvent[],
  now: number,
  thresholdMs: number,
): AuditEvent[] {
  const cutoff = now - thresholdMs
  return orphanIntents(events).filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t <= cutoff
  })
}

export type OrphanAlertDeps = {
  now: number
  thresholdMs: number
  loadEvents: () => Promise<AuditEvent[]>
  listAdmins: () => Promise<UserKey[]>
  notify: (event: NotificationEvent) => Promise<void>
  wasAlerted: (intentId: string) => boolean
  markAlerted: (intentId: string) => void
}

/** Stable notification payload for one aged unpaired Intent (no ledger write). */
export function orphanAlertNotification(input: {
  intent: AuditEvent
  now: number
  thresholdMs: number
  admins: UserKey[]
}): NotificationEvent {
  const { intent, now, thresholdMs, admins } = input
  return {
    id: `audit-orphan:${intent.id}`,
    category: 'security',
    title: 'Audit Intent without Outcome',
    summary: `Intent ${intent.id} (${intent.action}) has no Outcome after ${Math.round(thresholdMs / 60_000)} minutes.`,
    href: '/audit',
    audience: 'personal',
    recipients: admins.map((admin) => ({ iss: admin.iss, sub: admin.sub })),
    createdAt: new Date(now).toISOString(),
  }
}

/**
 * Notifies instance admins for each aged unpaired Intent once.
 * Does not append audit ledger events (orphan Intent remains the flag).
 */
export async function alertAgedOrphanIntents(deps: OrphanAlertDeps): Promise<string[]> {
  const aged = agedOrphanIntents(await deps.loadEvents(), deps.now, deps.thresholdMs)
  const pending = aged.filter((e) => !deps.wasAlerted(e.id))
  if (pending.length === 0) return []

  const admins = await deps.listAdmins()
  if (admins.length === 0) return []

  const alerted: string[] = []
  for (const intent of pending) {
    await deps.notify(
      orphanAlertNotification({
        intent,
        now: deps.now,
        thresholdMs: deps.thresholdMs,
        admins,
      }),
    )
    deps.markAlerted(intent.id)
    alerted.push(intent.id)
  }
  return alerted
}

/** Ports for a deep orphan-aging alerter (owned dedupe + injectable collaborators). */
export type OrphanAgingAlerterPorts = {
  loadEvents: () => Promise<AuditEvent[]>
  listAdmins?: () => Promise<UserKey[]>
  notify?: (event: NotificationEvent) => Promise<void>
  now?: () => number
  thresholdMs?: number
}

export type OrphanAgingAlerter = {
  /** Scan once and notify for newly aged orphans; returns Intent ids alerted this tick. */
  tick(opts?: { now?: number; thresholdMs?: number }): Promise<string[]>
  /** Clears owned idempotency state (tests / process restart simulation). */
  reset(): void
}

/**
 * Deep module: threshold resolution, dedupe, and admin notify behind `tick()`.
 * Each alerter owns its alerted-Intent set — two instances do not share state.
 */
export function createOrphanAgingAlerter(ports: OrphanAgingAlerterPorts): OrphanAgingAlerter {
  const alertedIntentIds = new Set<string>()
  return {
    async tick(opts = {}) {
      const now = opts.now ?? ports.now?.() ?? currentClock.now()
      const thresholdMs = opts.thresholdMs ?? ports.thresholdMs ?? env.auditOrphanAlertSec * 1000
      try {
        return await alertAgedOrphanIntents({
          now,
          thresholdMs,
          loadEvents: ports.loadEvents,
          listAdmins: ports.listAdmins ?? listInstanceAdmins,
          notify: ports.notify ?? emitNotification,
          wasAlerted: (id) => alertedIntentIds.has(id),
          markAlerted: (id) => {
            alertedIntentIds.add(id)
          },
        })
      } catch (err) {
        console.error('[mice-auth] orphan aging alert failed', err)
        return []
      }
    },
    reset() {
      alertedIntentIds.clear()
    },
  }
}

/** Process-default alerter used by boot / {@link runOrphanAgingAlert}. */
let processLoadEvents: (() => Promise<AuditEvent[]>) | null = null
let defaultAlerter: OrphanAgingAlerter | null = null

function processAlerter(): OrphanAgingAlerter {
  if (!defaultAlerter) {
    defaultAlerter = createOrphanAgingAlerter({
      loadEvents: () => {
        if (!processLoadEvents) throw new Error('orphan aging alerter has no loadEvents')
        return processLoadEvents()
      },
    })
  }
  return defaultAlerter
}

/** Production tick: scan the trail and alert; swallows notify failures. */
export async function runOrphanAgingAlert(opts: {
  now?: number
  thresholdMs?: number
  loadEvents: () => Promise<AuditEvent[]>
}): Promise<string[]> {
  processLoadEvents = opts.loadEvents
  return processAlerter().tick({
    now: opts.now,
    thresholdMs: opts.thresholdMs,
  })
}

/** Test seam: clear process-local alert dedupe. */
export function resetOrphanAlertState(): void {
  defaultAlerter?.reset()
}
