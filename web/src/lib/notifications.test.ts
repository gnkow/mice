import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import {
  decodeVapidKey, deferredToastCount, effectiveResourceMode, fetchNotifications, fetchNotificationSettings,
  fetchNotificationToasts, fetchUnreadCount, freshToastItems, markNotificationsRead,
  notificationIdentity, registerPushSubscription, removePushSubscription, resourceOverrideError,
  safeNotificationHref, saveNotificationSettings, setNotificationRead, toastFingerprint,
  type NotificationItem, type NotificationPreferences,
} from './notifications.ts'

const now = Date.parse('2026-10-21T12:00:00Z')
function item(partial: Partial<NotificationItem> = {}): NotificationItem {
  return { id: 'n1', category: 'jobs', title: 'Job completed', summary: 'Done', createdAt: new Date(now).toISOString(), read: false, count: 1, ...partial }
}
const preferences: NotificationPreferences = {
  enabled: true, categories: { jobs: { enabled: true, toast: true, email: false, push: false } },
  timezone: 'Europe/Berlin', emailSchedule: 'daily',
  quietHours: { enabled: false, start: '22:00', end: '08:00' }, resourceOverrides: [],
}

test('notification links allow only same-origin HTTP(S) destinations', () => {
  const origin = 'https://mice.example'
  assert.equal(safeNotificationHref('/jobs/a?q=1#logs', origin), '/jobs/a?q=1#logs')
  assert.equal(safeNotificationHref('https://mice.example/notifications', origin), '/notifications')
  for (const href of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)', 'data:text/html,hi', 'https://mice.example@evil.example/']) {
    assert.equal(safeNotificationHref(href, origin), undefined)
  }
})

test('toast selection suppresses stale, replayed, read and future entries, retaining new group versions', () => {
  const existing = item()
  const grouped = item({ count: 2 })
  assert.deepEqual(freshToastItems([
    existing, grouped, grouped, item({ id: 'old', createdAt: new Date(now - 31_000).toISOString() }),
    item({ id: 'read', read: true }), item({ id: 'invalid', createdAt: 'invalid' }),
    item({ id: 'future', createdAt: new Date(now + 60_000).toISOString() }),
  ], [toastFingerprint(existing)], now - 60_000, now), [grouped])
  assert.deepEqual(freshToastItems([item({ createdAt: new Date(now - 1000).toISOString() })], [], now, now), [])
})

test('toast storage identity cannot collide between issuers or subjects', () => {
  assert.notEqual(notificationIdentity('issuer-a', 'same'), notificationIdentity('issuer-b', 'same'))
  assert.notEqual(notificationIdentity('a:b', 'c'), notificationIdentity('a', 'b:c'))
})

test('deferred toasts summarize quiet-hour/reconnect activity without replaying pre-session history', () => {
  const deferred = item({ createdAt: new Date(now - 60_000).toISOString() })
  const old = item({ id: 'old', createdAt: new Date(now - 3_600_000).toISOString() })
  assert.equal(deferredToastCount([deferred, deferred, old, item()], [], now - 120_000, now), 1)
  assert.equal(deferredToastCount([deferred], [toastFingerprint(deferred)], now - 120_000, now), 0)
  assert.equal(deferredToastCount([deferred, old], [], now, now), 0)
})

test('resource overrides enforce hierarchy and resolve nearest explicit setting', () => {
  assert.ok(resourceOverrideError({ repo: 'repo' }))
  assert.ok(resourceOverrideError({ namespace: 'ns', type: 'job' }))
  assert.ok(resourceOverrideError({ namespace: 'ns', repo: 'repo', id: 'x' }))
  assert.equal(resourceOverrideError({ namespace: 'ns', repo: 'repo', type: 'job', id: 'x' }), undefined)
  const overrides: NotificationPreferences['resourceOverrides'] = [
    { resource: { namespace: 'ns' }, mode: 'mute' },
    { resource: { namespace: 'ns', repo: 'repo' }, mode: 'watch' },
    { resource: { namespace: 'ns', repo: 'repo', type: 'job', id: 'x' }, mode: 'mute' },
  ]
  assert.equal(effectiveResourceMode({ namespace: 'other' }, overrides), 'watch')
  assert.equal(effectiveResourceMode({ namespace: 'ns' }, overrides), 'mute')
  assert.equal(effectiveResourceMode({ namespace: 'ns', repo: 'repo', type: 'job', id: 'y' }, overrides), 'watch')
  assert.equal(effectiveResourceMode({ namespace: 'ns', repo: 'repo', type: 'job', id: 'x' }, overrides), 'mute')
  assert.deepEqual([...decodeVapidKey('AQID-_8')], [1, 2, 3, 251, 255])
})

test('API uses exact server routes, raw preferences/subscription bodies and server snapshot cutoff', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const settings = { preferences, availability: { email: true, push: false } }
  Object.assign(globalThis, { window: { dispatchEvent() {} } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() {} } })
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, init })
    const data = url.includes('preferences') ? settings : url.includes('unread-count') ? { unreadCount: 2 } : { items: [item()], unreadCount: 2, nextCursor: 'next' }
    return Response.json(data, { headers: { Date: 'Wed, 21 Oct 2026 12:00:00 GMT' } })
  }
  try {
    const page = await fetchNotifications({ cursor: 'a/b &c', unread: true })
    assert.equal(requests[0].url, '/auth/notifications?cursor=a%2Fb+%26c&unread=1')
    assert.equal(page.cutoff, '2026-10-21T12:00:00.000Z')
    assert.equal(page.nextCursor, 'next')
    assert.equal(await fetchUnreadCount(), 2)
    assert.equal((await fetchNotificationToasts())[0].id, 'n1')
    assert.deepEqual(await fetchNotificationSettings(), settings)
    assert.deepEqual(await saveNotificationSettings(preferences), settings)
    await setNotificationRead('a/b', false)
    await markNotificationsRead(page.cutoff)
    await registerPushSubscription({ toJSON: () => ({ endpoint: 'https://push.example/device', keys: { auth: 'a', p256dh: 'b' } }) })
    await removePushSubscription('https://push.example/device')
    assert.equal(requests[4].init.body, JSON.stringify(preferences))
    assert.equal(requests[5].url, '/auth/notifications/a%2Fb')
    assert.equal(requests[5].init.body, '{"read":false}')
    assert.equal(requests[6].init.body, '{"before":"2026-10-21T12:00:00.000Z"}')
    assert.deepEqual(JSON.parse(String(requests[7].init.body)), { endpoint: 'https://push.example/device', keys: { auth: 'a', p256dh: 'b' } })
    assert.equal(requests[8].init.method, 'DELETE')
    assert.equal(requests[8].init.body, '{"endpoint":"https://push.example/device"}')
    assert.equal(new Headers(requests[7].init.headers).get('Content-Type'), 'application/json')
    assert.ok(requests.every(request => request.init.credentials === 'same-origin'))
    globalThis.fetch = async () => Response.json({ error: 'Delivery not configured' }, { status: 409 })
    await assert.rejects(saveNotificationSettings(preferences), /Delivery not configured \(409\)/)
    globalThis.fetch = async () => new Response('unavailable', { status: 503 })
    await assert.rejects(fetchUnreadCount(), /\(503\)/)
    globalThis.fetch = async () => new Response(null, { status: 204 })
    await setNotificationRead('n1', true)
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(globalThis, { window: originalWindow })
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('push worker renders typed payloads and rejects external click destinations', async () => {
  const handlers: Record<string, (event: unknown) => void> = {}
  const shown: Array<{ title: string; options: { data: { href: string }; tag?: string } }> = []
  const opened: string[] = []
  runInNewContext(await readFile(new URL('../../public/notifications-sw.js', import.meta.url), 'utf8'), {
    URL,
    self: {
      location: { origin: 'https://mice.example' },
      addEventListener(name: string, handler: (event: unknown) => void) { handlers[name] = handler },
      registration: { showNotification(title: string, options: { data: { href: string } }) { shown.push({ title, options }); return Promise.resolve() } },
      clients: { matchAll: async () => [], openWindow: async (href: string) => { opened.push(href) } },
    },
  })
  const pending: Promise<unknown>[] = []
  const waitUntil = (promise: Promise<unknown>) => pending.push(promise)
  handlers.push({ data: { json: () => ({ title: 'Done', body: 'Job completed', href: '/jobs/1', id: 'n1' }) }, waitUntil })
  assert.equal(shown[0].title, 'Done')
  assert.equal(shown[0].options.tag, 'n1')
  handlers.push({ data: { json: () => { throw new Error('invalid JSON') } }, waitUntil })
  assert.equal(shown.length, 1)
  for (const href of ['https://evil.example/steal', 'javascript:alert(1)', '/jobs/1']) {
    handlers.notificationclick({ notification: { close() {}, data: { href } }, waitUntil })
  }
  await Promise.all(pending)
  assert.deepEqual(opened, ['https://mice.example/notifications', 'https://mice.example/notifications', 'https://mice.example/jobs/1'])
})
