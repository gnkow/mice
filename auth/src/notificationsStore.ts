import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
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
  let auditOffset = 0
  try { auditOffset = statSync(notificationAuditPath()).size } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { version: 1, auditOffset, users: {}, preferences: {}, events: {}, entries: [], deliveries: [], subscriptions: {}, tombstones: {} }
}

export function readNotificationState(): NotificationState {
  let raw: string
  try { raw = readFileSync(notificationStorePath(), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return freshState()
    throw error
  }
  const value = JSON.parse(raw) as NotificationState
  if (value.version !== 1 || !Number.isSafeInteger(value.auditOffset) || value.auditOffset < 0 ||
      !value.users || !value.preferences || !value.events || !Array.isArray(value.entries) ||
      !Array.isArray(value.deliveries) || !value.subscriptions || !value.tombstones) throw new Error('Invalid notification store schema')
  return value
}

export function writeNotificationState(state: NotificationState): void {
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 })
  const staging = join(env.dataDir, `.notifications-${randomUUID()}.json`)
  let fd: number | undefined
  try {
    fd = openSync(staging, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(state), 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(staging, notificationStorePath())
    const directory = openSync(env.dataDir, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(staging)) unlinkSync(staging)
  }
}

/** Synchronous transactions are serialized by the one auth process; never await inside one. */
export function notificationTransaction<T>(fn: (state: NotificationState) => T): T {
  const state = readNotificationState()
  const result = fn(state)
  writeNotificationState(state)
  return result
}
