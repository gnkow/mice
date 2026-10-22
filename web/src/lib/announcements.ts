import { authzFetch } from './authzApi'

export type AnnouncementSeverity = 'info' | 'warning' | 'critical'
export type Announcement = {
  id: string
  title: string
  message: string
  severity: AnnouncementSeverity
  active: boolean
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: string
}
export type AnnouncementInput = {
  title: string
  message: string
  severity: AnnouncementSeverity
  expiresAt: string | null
}

export const SEVERITY_LABELS: Record<AnnouncementSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

/** Live announcements for everyone; `all` (instance admins) includes inactive and expired ones. */
export async function listAnnouncements(opts: { all?: boolean; signal?: AbortSignal } = {}) {
  const res = await authzFetch<{ announcements: Announcement[] }>(
    `/auth/announcements${opts.all ? '?all=1' : ''}`,
    { signal: opts.signal },
  )
  return res.announcements
}

export function createAnnouncement(input: AnnouncementInput) {
  return authzFetch<{ announcement: Announcement }>('/auth/announcements', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAnnouncement(id: string, patch: Partial<AnnouncementInput & { active: boolean }>) {
  return authzFetch<{ announcement: Announcement }>(`/auth/announcements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteAnnouncement(id: string) {
  return authzFetch<{ ok: boolean }>(`/auth/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function isExpired(a: Announcement, now = Date.now()): boolean {
  return Boolean(a.expiresAt && Date.parse(a.expiresAt) <= now)
}

const DISMISSED_KEY = 'mice.announcements.dismissed'

/** Dismissals are keyed by id and revision, so an edited announcement shows again. */
export const dismissalKey = (a: Announcement) => `${a.id}:${a.updatedAt}`

export function loadDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveDismissed(keys: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(keys.slice(-100)))
  } catch { /* ignore */ }
}
