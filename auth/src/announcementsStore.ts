import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { createDocumentStore } from './stores.js'

export const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'] as const
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number]

export type Announcement = {
  id: string
  title: string
  message: string
  severity: AnnouncementSeverity
  /** Hidden from non-admins when false. */
  active: boolean
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
}

export const MAX_TITLE = 120
export const MAX_MESSAGE = 2000

export class AnnouncementError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message)
  }
}

function path(): string {
  return join(env.dataDir, 'announcements.json')
}

const doc = createDocumentStore<{ announcements?: Announcement[] }>({ path, initial: () => ({}), onCorrupt: 'initial' })

function read(): Announcement[] {
  const f = doc.read()
  return Array.isArray(f.announcements) ? f.announcements : []
}

function write(list: Announcement[]): void {
  doc.write({ announcements: list })
}

export function isLive(a: Announcement, now = Date.now()): boolean {
  return a.active && (!a.expiresAt || Date.parse(a.expiresAt) > now)
}

/** Newest first. `all` includes inactive and expired entries (admin view). */
export function listAnnouncements(opts: { all?: boolean } = {}): Announcement[] {
  const rows = read().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return opts.all ? rows : rows.filter((a) => isLive(a))
}

function parseExpiry(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
    throw new AnnouncementError('expiresAt must be an ISO date-time', 400)
  }
  return new Date(v).toISOString()
}

function parseFields(input: Record<string, unknown>, partial: boolean) {
  const out: Partial<Pick<Announcement, 'title' | 'message' | 'severity' | 'active' | 'expiresAt'>> = {}
  if (!partial || input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title || title.length > MAX_TITLE) throw new AnnouncementError(`title is required (max ${MAX_TITLE} characters)`, 400)
    out.title = title
  }
  if (!partial || input.message !== undefined) {
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (message.length > MAX_MESSAGE) throw new AnnouncementError(`message is too long (max ${MAX_MESSAGE} characters)`, 400)
    out.message = message
  }
  if (input.severity !== undefined) {
    if (!(ANNOUNCEMENT_SEVERITIES as readonly unknown[]).includes(input.severity)) {
      throw new AnnouncementError(`severity must be one of ${ANNOUNCEMENT_SEVERITIES.join(', ')}`, 400)
    }
    out.severity = input.severity as AnnouncementSeverity
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') throw new AnnouncementError('active must be a boolean', 400)
    out.active = input.active
  }
  if (input.expiresAt !== undefined) out.expiresAt = parseExpiry(input.expiresAt)
  return out
}

export function createAnnouncement(input: Record<string, unknown>, createdBy: string): Announcement {
  const f = parseFields(input, false)
  const now = new Date().toISOString()
  const row: Announcement = {
    id: randomUUID(),
    title: f.title!,
    message: f.message ?? '',
    severity: f.severity ?? 'info',
    active: f.active ?? true,
    expiresAt: f.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy,
  }
  write([...read(), row])
  return row
}

export function updateAnnouncement(id: string, input: Record<string, unknown>): Announcement {
  const f = parseFields(input, true)
  const list = read()
  const i = list.findIndex((a) => a.id === id)
  if (i < 0) throw new AnnouncementError('Announcement not found', 404)
  list[i] = { ...list[i]!, ...f, updatedAt: new Date().toISOString() }
  write(list)
  return list[i]!
}

export function deleteAnnouncement(id: string): Announcement {
  const list = read()
  const row = list.find((a) => a.id === id)
  if (!row) throw new AnnouncementError('Announcement not found', 404)
  write(list.filter((a) => a.id !== id))
  return row
}
