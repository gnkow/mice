import { join } from 'node:path'
import { env } from './env.js'
import { readText } from './jsonStore.js'
import { createDocumentStore } from './stores.js'
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
  auditOffset: number
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

function freshState(): NotificationState {
  const audit = readText(notificationAuditPath())
  const auditOffset = audit === undefined ? 0 : Buffer.byteLength(audit)
  return { version: 1, auditOffset, users: {}, preferences: {}, events: {}, entries: [], deliveries: [], subscriptions: {}, tombstones: {} }
}

const store = createDocumentStore<NotificationState>({
  path: notificationStorePath,
  initial: freshState,
  durable: true,
  space: 0,
  validate(value) {
    if (value.version !== 1 || !Number.isSafeInteger(value.auditOffset) || value.auditOffset < 0 ||
        !value.users || !value.preferences || !value.events || !Array.isArray(value.entries) ||
        !Array.isArray(value.deliveries) || !value.subscriptions || !value.tombstones) throw new Error('Invalid notification store schema')
  },
})

export function readNotificationState(): NotificationState {
  return store.read()
}

/** Synchronous transactions are serialized by the one auth process; never await inside one. */
export function notificationTransaction<T>(fn: (state: NotificationState) => T): T {
  return store.transaction(fn)
}
