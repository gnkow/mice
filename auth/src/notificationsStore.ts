import { join } from 'node:path'
import { env } from './env.js'
import { atomically, readLogLines, readText } from './jsonStore.js'
import { createAppendOnlyLog, createCollection, createDocumentStore } from './stores.js'
import type { SessionUser } from './session.js'
import type { NotificationEvent, NotificationPreferences } from './notificationsTypes.js'

export type NotificationUser = {
  identity: Pick<SessionUser, 'iss' | 'sub' | 'email' | 'name' | 'groups'>
  rememberedAt: string
  claimsAt: string
}
export type NotificationEntry = {
  id: string
  event: string
  user: string
  personal: boolean
  read: boolean
  toasted: boolean
  receivedAt: string
}
export type NotificationDelivery = {
  id: string
  user: string
  entry: string
  channel: 'email' | 'push'
  due: number
  attempts: number
  state: 'pending' | 'sending' | 'sent' | 'cancelled' | 'dead'
  lease?: string
  leaseUntil?: number
  lastError?: string
}
export type NotificationSubscription = {
  endpoint: string
  expirationTime?: number | null
  keys: { auth: string; p256dh: string }
}
export type NotificationState = {
  version: 1
  /** Sequence of the last audit row already projected into notifications. */
  auditSeq: number
  users: Record<string, NotificationUser>
  preferences: Record<string, NotificationPreferences>
  events: Record<string, NotificationEvent & { createdAt: string; observedAt: string }>
  entries: NotificationEntry[]
  deliveries: NotificationDelivery[]
  subscriptions: Record<string, NotificationSubscription[]>
  tombstones: Record<string, string>
}

export function notificationUserKey(user: { iss: string; sub: string }): string {
  return JSON.stringify([user.iss, user.sub])
}

export function notificationAuditPath(): string { return join(env.dataDir, 'audit.jsonl') }
export function notificationStorePath(): string { return join(env.dataDir, 'notifications.json') }

export function notificationEntriesPath(): string { return join(env.dataDir, 'notifications.entries') }
export function notificationDeliveriesPath(): string { return join(env.dataDir, 'notifications.deliveries') }
export function notificationEventsPath(): string { return join(env.dataDir, 'notifications.events') }
export function notificationRowPaths(): string[] { return [notificationEntriesPath(), notificationDeliveriesPath(), notificationEventsPath()] }

const entryRows = createCollection<NotificationEntry>(notificationEntriesPath)
const deliveryRows = createCollection<NotificationDelivery>(notificationDeliveriesPath)
const eventRows = createCollection<NotificationState['events'][string] & { id?: string }>(notificationEventsPath)

export const notificationAuditLog = createAppendOnlyLog<unknown>(notificationAuditPath)

function freshState(): NotificationState {
  return { version: 1, auditSeq: notificationAuditLog.lastSeq(), users: {}, preferences: {}, events: {}, entries: [], deliveries: [], subscriptions: {}, tombstones: {} }
}

const store = createDocumentStore<NotificationState>({
  path: notificationStorePath,
  initial: freshState,
  durable: true,
  space: 0,
  validate(value) {
    const legacy = value as unknown as { auditOffset?: number }
    const cursor = value.auditSeq ?? legacy.auditOffset
    if (value.version !== 1 || !Number.isSafeInteger(cursor) || (cursor as number) < 0 ||
        !value.users || !value.preferences || !value.events || !Array.isArray(value.entries) ||
        !Array.isArray(value.deliveries) || !value.subscriptions || !value.tombstones) throw new Error('Invalid notification store schema')
  },
  migrate(value) {
    const legacy = value as unknown as { auditOffset?: number }
    if (value.auditSeq === undefined) {
      const offset = legacy.auditOffset ?? 0
      let bytes = 0
      let seq = 0
      for (const row of readLogLines(notificationAuditPath(), 0)) {
        bytes += Buffer.byteLength(row.line, 'utf8') + 1
        if (bytes > offset) break
        seq = row.seq
      }
      value.auditSeq = seq
      delete legacy.auditOffset
    }
  },
})

/**
 * Entries, deliveries and events are rows; the document keeps the cursor, users, preferences, subscriptions and tombstones.
 * A document that still embeds them (written before rows existed) is authoritative until its next change moves them out.
 */
function load(): { state: NotificationState; fresh: boolean } {
  const fresh = readText(notificationStorePath()) === undefined
  const state = store.read()
  if (!fresh && state.entries.length === 0 && state.deliveries.length === 0 && Object.keys(state.events).length === 0) {
    state.entries = entryRows.list()
    state.deliveries = deliveryRows.list()
    for (const e of eventRows.list()) state.events[e.id!] = e
  }
  return { state, fresh }
}

/** Write only the rows that differ from what was loaded. */
function syncRows<T extends { id: string }>(rows: ReturnType<typeof createCollection<T>>, before: Map<string, string>, after: T[], reset: boolean): void {
  if (reset) rows.clear()
  const keep = new Set<string>()
  for (const row of after) {
    keep.add(row.id)
    const json = JSON.stringify(row)
    if (reset || before.get(row.id) !== json) rows.put(row.id, row)
  }
  for (const id of before.keys()) if (!keep.has(id)) rows.remove(id)
}

const snapshot = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, JSON.stringify(r)]))

export function readNotificationState(): NotificationState {
  return load().state
}

/** Synchronous transactions are serialized by the one auth process; never await inside one. */
export function notificationTransaction<T>(fn: (state: NotificationState) => T): T {
  const { state, fresh } = load()
  // A legacy embedded document is not in the rows yet, so everything counts as changed.
  const embedded = state.entries.length + state.deliveries.length + Object.keys(state.events).length > 0 && entryRows.count() + deliveryRows.count() + eventRows.count() === 0
  const reset = fresh || embedded
  const beforeEntries = reset ? new Map<string, string>() : snapshot(state.entries)
  const beforeDeliveries = reset ? new Map<string, string>() : snapshot(state.deliveries)
  const eventList = (): (NotificationState['events'][string] & { id: string })[] => Object.entries(state.events).map(([id, e]) => ({ ...e, id }))
  const beforeEvents = reset ? new Map<string, string>() : snapshot(eventList())
  const result = fn(state)
  atomically(() => {
    syncRows(entryRows, beforeEntries, state.entries, reset)
    syncRows(deliveryRows, beforeDeliveries, state.deliveries, reset)
    syncRows(eventRows as never, beforeEvents, eventList(), reset)
    store.write({ ...state, entries: [], deliveries: [], events: {} })
  })
  return result
}
