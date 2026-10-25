import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { announcements } from './db/schema.js'

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

const fromRow = (r: typeof announcements.$inferSelect): Announcement => ({
  id: r.id,
  title: r.title,
  message: r.message,
  severity: r.severity as AnnouncementSeverity,
  active: r.active,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  createdBy: r.createdBy,
})

const toRow = (a: Announcement) => ({
  ...a,
  expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
  createdAt: new Date(a.createdAt),
  updatedAt: new Date(a.updatedAt),
})

export function isLive(a: Announcement, now = Date.now()): boolean {
  return a.active && (!a.expiresAt || Date.parse(a.expiresAt) > now)
}

/** Newest first. `all` includes inactive and expired entries (admin view). */
export async function listAnnouncements(opts: { all?: boolean } = {}): Promise<Announcement[]> {
  const rows = (await getDb().select().from(announcements).orderBy(desc(announcements.createdAt))).map(fromRow)
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

export async function createAnnouncement(input: Record<string, unknown>, createdBy: string): Promise<Announcement> {
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
  await getDb().insert(announcements).values(toRow(row))
  return row
}

export async function updateAnnouncement(id: string, input: Record<string, unknown>): Promise<Announcement> {
  const f = parseFields(input, true)
  const [row] = await getDb()
    .update(announcements)
    .set({
      ...f,
      expiresAt: f.expiresAt === undefined ? undefined : f.expiresAt ? new Date(f.expiresAt) : null,
      updatedAt: new Date(),
    })
    .where(eq(announcements.id, id))
    .returning()
  if (!row) throw new AnnouncementError('Announcement not found', 404)
  return fromRow(row)
}

export async function deleteAnnouncement(id: string): Promise<Announcement> {
  const [row] = await getDb().delete(announcements).where(eq(announcements.id, id)).returning()
  if (!row) throw new AnnouncementError('Announcement not found', 404)
  return fromRow(row)
}
