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

const alertedIntentIds = new Set<string>()

export type OrphanAlertDeps = {
  now: number
  thresholdMs: number
  loadEvents: () => Promise<AuditEvent[]>
  listAdmins: () => Promise<UserKey[]>
  notify: (event: NotificationEvent) => Promise<void>
  wasAlerted: (intentId: string) => boolean
  markAlerted: (intentId: string) => void
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
    await deps.notify({
      id: `audit-orphan:${intent.id}`,
      category: 'security',
      title: 'Audit Intent without Outcome',
      summary: `Intent ${intent.id} (${intent.action}) has no Outcome after ${Math.round(deps.thresholdMs / 60_000)} minutes.`,
      href: '/audit',
      audience: 'personal',
      recipients: admins.map((admin) => ({ iss: admin.iss, sub: admin.sub })),
      createdAt: new Date(deps.now).toISOString(),
    })
    deps.markAlerted(intent.id)
    alerted.push(intent.id)
  }
  return alerted
}

/** Production tick: scan the trail and alert; swallows notify failures. */
export async function runOrphanAgingAlert(opts: {
  now?: number
  thresholdMs?: number
  loadEvents: () => Promise<AuditEvent[]>
}): Promise<string[]> {
  const now = opts.now ?? currentClock.now()
  const thresholdMs = opts.thresholdMs ?? env.auditOrphanAlertSec * 1000
  try {
    return await alertAgedOrphanIntents({
      now,
      thresholdMs,
      loadEvents: opts.loadEvents,
      listAdmins: listInstanceAdmins,
      notify: emitNotification,
      wasAlerted: (id) => alertedIntentIds.has(id),
      markAlerted: (id) => {
        alertedIntentIds.add(id)
      },
    })
  } catch (err) {
    console.error('[mice-auth] orphan aging alert failed', err)
    return []
  }
}

/** Test seam: clear process-local alert dedupe. */
export function resetOrphanAlertState(): void {
  alertedIntentIds.clear()
}
