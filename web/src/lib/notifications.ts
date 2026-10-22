export const notificationCategories = [
  'access', 'jobs', 'sessions', 'repositories', 'files', 'metadata', 'security', 'announcements',
] as const

export type NotificationResource = { namespace?: string; repo?: string; type?: string; id?: string }
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
export type CategoryPreference = { enabled: boolean; toast: boolean; email: boolean; push: boolean }
export type NotificationPreferences = {
  enabled: boolean
  categories: Record<string, CategoryPreference>
  emailSchedule: 'immediate' | 'daily' | 'weekly'
  timezone: string
  quietHours: { enabled: boolean; start: string; end: string }
  resourceOverrides: Array<{ resource: NotificationResource; mode: 'watch' | 'mute' }>
}
export type NotificationSettings = {
  preferences: NotificationPreferences
  availability: { email: boolean; push: boolean; vapidPublicKey?: string }
}
export type NotificationPage = {
  items: NotificationItem[]
  unreadCount: number
  nextCursor?: string
  cutoff: string
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; date: string | null }> {
  const response = await fetch(`/auth/notifications${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json() as { error?: string; message?: string }
      detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : ''
    } catch { /* A non-JSON error still includes its HTTP status. */ }
    throw new Error(`Notifications: ${detail || response.statusText || 'request failed'} (${response.status})`)
  }
  return {
    data: response.status === 204 ? undefined as T : await response.json() as T,
    date: response.headers.get('Date'),
  }
}

export async function fetchNotifications(options: { cursor?: string; unread?: boolean; signal?: AbortSignal } = {}): Promise<NotificationPage> {
  const query = new URLSearchParams()
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.unread) query.set('unread', '1')
  const started = new Date().toISOString()
  const { data, date } = await request<Omit<NotificationPage, 'cutoff'> & { cutoff?: string }>(`?${query}`, { signal: options.signal })
  return { ...data, cutoff: data.cutoff && Number.isFinite(Date.parse(data.cutoff)) ? data.cutoff :
    date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : started }
}
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number> {
  return (await request<{ unreadCount: number }>('/unread-count', { signal })).data.unreadCount
}
export async function fetchNotificationToasts(signal?: AbortSignal): Promise<NotificationItem[]> {
  return (await request<{ items: NotificationItem[] }>('/toast', { signal })).data.items
}
export async function setNotificationRead(id: string, read: boolean): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ read }) })
  notifyNotificationsChanged()
}
export async function markNotificationsRead(before: string): Promise<void> {
  await request('/read-all', { method: 'POST', body: JSON.stringify({ before }) })
  notifyNotificationsChanged()
}
export async function fetchNotificationSettings(signal?: AbortSignal): Promise<NotificationSettings> {
  return (await request<NotificationSettings>('/preferences', { signal })).data
}
export async function saveNotificationSettings(preferences: NotificationPreferences): Promise<NotificationSettings> {
  const result = (await request<NotificationSettings>('/preferences', { method: 'PATCH', body: JSON.stringify(preferences) })).data
  notifyNotificationsChanged()
  return result
}
export async function registerPushSubscription(subscription: Pick<PushSubscription, 'toJSON'>): Promise<void> {
  await request('/push-subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) })
}
export async function removePushSubscription(endpoint: string): Promise<void> {
  await request('/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) })
}
export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event('notifications-changed'))
  try { localStorage.setItem('mice.notifications.changed', `${Date.now()}:${Math.random()}`) } catch { /* Polling remains available. */ }
}
export function subscribeNotificationsChanged(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === 'mice.notifications.changed') listener() }
  window.addEventListener('notifications-changed', listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('notifications-changed', listener)
    window.removeEventListener('storage', onStorage)
  }
}
export function notificationIdentity(iss: string, sub: string): string {
  return `mice.notifications:${encodeURIComponent(JSON.stringify([iss, sub]))}`
}
export function safeNotificationHref(href: string | undefined, origin: string): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, origin)
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return undefined
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return undefined }
}
export function toastFingerprint(item: NotificationItem): string {
  return JSON.stringify([item.id, item.createdAt, item.count])
}
export function freshToastItems(items: NotificationItem[], seen: string[], startedAt: number, now: number): NotificationItem[] {
  const known = new Set(seen)
  return items.filter(item => {
    const time = Date.parse(item.createdAt)
    const key = toastFingerprint(item)
    if (item.read || !Number.isFinite(time) || time < Math.max(startedAt, now - 30_000) || time > now + 5_000 || known.has(key)) return false
    known.add(key)
    return true
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
export function deferredToastCount(items: NotificationItem[], seen: string[], startedAt: number, now: number): number {
  const known = new Set(seen)
  return items.filter(item => {
    const time = Date.parse(item.createdAt)
    const key = toastFingerprint(item)
    if (item.read || !Number.isFinite(time) || time < Math.max(startedAt, now - 86_400_000) || time >= now - 30_000 || known.has(key)) return false
    known.add(key)
    return true
  }).length
}
export function decodeVapidKey(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}
export function resourceOverrideError(resource: NotificationResource): string | undefined {
  if (resource.repo && !resource.namespace) return 'A repository requires a namespace.'
  if (resource.type && (!resource.namespace || !resource.repo)) return 'A resource type requires a namespace and repository.'
  if (resource.id && !resource.type) return 'A resource ID requires a type.'
  return undefined
}
export function effectiveResourceMode(resource: NotificationResource, overrides: NotificationPreferences['resourceOverrides']): 'watch' | 'mute' {
  let mode: 'watch' | 'mute' = 'watch'
  let specificity = -1
  for (const override of overrides) {
    const entries = Object.entries(override.resource).filter(([, value]) => value)
    if (entries.length > specificity && entries.every(([key, value]) => resource[key as keyof NotificationResource] === value)) {
      mode = override.mode
      specificity = entries.length
    }
  }
  return mode
}
