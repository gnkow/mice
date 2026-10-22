/* Dedicated Web Push worker; it never caches authenticated responses. */
self.addEventListener('push', event => {
  let payload
  try { payload = event.data?.json() } catch { return }
  if (!payload || typeof payload.title !== 'string') return
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: typeof payload.body === 'string' ? payload.body : '',
    tag: typeof payload.id === 'string' ? payload.id : undefined,
    data: { href: typeof payload.href === 'string' ? payload.href : '/notifications' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  let target = new URL('/notifications', self.location.origin)
  try {
    const proposed = new URL(event.notification.data?.href || '/notifications', self.location.origin)
    if (proposed.origin === self.location.origin && ['http:', 'https:'].includes(proposed.protocol)) target = proposed
  } catch { /* Invalid targets open the inbox. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url === target.href)
    if (existing) return existing.focus()
    return self.clients.openWindow(target.href)
  })())
})
