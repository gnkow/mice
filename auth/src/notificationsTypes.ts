export const notificationCategories = [
  'access', 'jobs', 'sessions', 'repositories', 'files', 'metadata', 'security', 'announcements',
] as const

export type NotificationCategory = typeof notificationCategories[number]
export type NotificationIdentity = { iss: string; sub: string }
export type NotificationResource = {
  namespace?: string
  repo?: string
  type?: string
  id?: string
}
export type NotificationPreferences = {
  enabled: boolean
  categories: Record<string, { enabled: boolean; toast: boolean; email: boolean; push: boolean }>
  emailSchedule: 'immediate' | 'daily' | 'weekly'
  timezone: string
  quietHours: { enabled: boolean; start: string; end: string }
  resourceOverrides: Array<{ resource: NotificationResource; mode: 'watch' | 'mute' }>
}
export type NotificationItem = {
  id: string
  category: string
  title: string
  summary: string
  href?: string
  createdAt: string
  read: boolean
  count: number
  resource?: NotificationResource
}

/** Only trusted producers may supply text; audit mapping never forwards arbitrary detail or messages. */
export type NotificationEvent = {
  id: string
  createdAt?: string
  category: NotificationCategory
  title: string
  summary: string
  href?: string
  resource?: NotificationResource
  actor?: NotificationIdentity
  recipients?: NotificationIdentity[]
  owner?: NotificationIdentity
  audience?: 'resource' | 'personal' | 'announcements' | 'access-reviewers'
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    enabled: true,
    categories: Object.fromEntries(notificationCategories.map((category) => [
      category, { enabled: true, toast: true, email: false, push: false },
    ])),
    emailSchedule: 'immediate',
    timezone: 'UTC',
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    resourceOverrides: [],
  }
}

export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object') throw new Error('Expected preferences object')
  const p = value as NotificationPreferences
  if (typeof p.enabled !== 'boolean' || !['immediate', 'daily', 'weekly'].includes(p.emailSchedule)) {
    throw new Error('Invalid enabled or emailSchedule')
  }
  if (typeof p.timezone !== 'string' || p.timezone.length > 100) throw new Error('Invalid timezone')
  try {
    new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format()
  } catch {
    throw new Error('Invalid IANA timezone')
  }
  const q = p.quietHours
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  if (!q || typeof q.enabled !== 'boolean' || !time.test(q.start) || !time.test(q.end) ||
      (q.enabled && q.start === q.end)) throw new Error('Invalid quiet hours')
  const categories: NotificationPreferences['categories'] = {}
  for (const category of notificationCategories) {
    const row = p.categories?.[category]
    if (!row || ['enabled', 'toast', 'email', 'push'].some((key) => typeof row[key as keyof typeof row] !== 'boolean')) {
      throw new Error(`Invalid category: ${category}`)
    }
    categories[category] = { enabled: row.enabled, toast: row.toast, email: row.email, push: row.push }
  }
  if (!Array.isArray(p.resourceOverrides) || p.resourceOverrides.length > 250) throw new Error('Invalid resource overrides')
  const resourceOverrides = p.resourceOverrides.map((override) => {
    if (!override || !['watch', 'mute'].includes(override.mode) || !override.resource ||
        typeof override.resource !== 'object') throw new Error('Invalid resource override')
    const resource: NotificationResource = {}
    for (const key of ['namespace', 'repo', 'type', 'id'] as const) {
      const v = override.resource[key]
      if (v !== undefined) {
        if (typeof v !== 'string' || !v || v.length > 1024 || /[\u0000-\u001f]/.test(v)) throw new Error('Invalid resource identity')
        resource[key] = v
      }
    }
    if ((resource.repo && !resource.namespace) || (resource.id && !resource.type)) throw new Error('Invalid resource hierarchy')
    return { resource, mode: override.mode }
  })
  return {
    enabled: p.enabled, categories, timezone: p.timezone, emailSchedule: p.emailSchedule,
    quietHours: { enabled: q.enabled, start: q.start, end: q.end }, resourceOverrides,
  }
}

export function resourceIsMuted(p: NotificationPreferences, resource?: NotificationResource): boolean {
  let specificity = -1
  let muted = false
  for (const override of p.resourceOverrides) {
    const keys = Object.keys(override.resource) as Array<keyof NotificationResource>
    const pathTypes = ['path', 'file', 'directory']
    const pathResource = pathTypes.includes(override.resource.type ?? '') && pathTypes.includes(resource?.type ?? '')
    if (keys.every((key) => override.resource[key] === resource?.[key] ||
        (key === 'type' && pathResource) ||
        (key === 'id' && pathResource && !!resource?.id?.startsWith(`${override.resource.id!.replace(/\/$/, '')}/`)))) {
      const score = keys.reduce((n, key) => n + ({ namespace: 1, repo: 2, type: 4, id: 8 }[key]), 0) +
        (override.resource.id?.length ?? 0) / 2048
      if (score >= specificity) {
        specificity = score
        muted = override.mode === 'mute'
      }
    }
  }
  return muted
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return { time: `${get('hour')}:${get('minute')}`, weekday: get('weekday') }
}

export function notificationQuiet(p: NotificationPreferences, at = new Date()): boolean {
  if (!p.quietHours.enabled) return false
  const { start, end } = p.quietHours
  const { time } = localParts(at, p.timezone)
  return start < end ? time >= start && time < end : time >= start || time < end
}

/** Calendar scans handle gaps/overlaps by taking the first matching real minute. */
export function nextNotificationDelivery(p: NotificationPreferences, channel: 'email' | 'push', after = Date.now()): number {
  if ((channel === 'push' || p.emailSchedule === 'immediate') && !notificationQuiet(p, new Date(after))) return after
  const minute = 60_000
  let scheduled = channel === 'push' || p.emailSchedule === 'immediate'
  for (let at = Math.floor(after / minute) * minute + minute; at <= after + 9 * 86_400_000; at += minute) {
    if (!scheduled) {
      const local = localParts(new Date(at), p.timezone)
      if (local.time !== '09:00' || (p.emailSchedule === 'weekly' && local.weekday !== 'Mon')) continue
      scheduled = true
    }
    if (notificationQuiet(p, new Date(at))) continue
    return at
  }
  throw new Error('Could not resolve notification delivery time')
}
