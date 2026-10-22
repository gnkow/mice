import { useEffect, useState } from 'react'
import { ArrowUpRight, Bell, Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AuthUser } from '../lib/auth'
import {
  deferredToastCount, fetchNotificationToasts, fetchUnreadCount, freshToastItems, notificationIdentity,
  safeNotificationHref, setNotificationRead, subscribeNotificationsChanged, toastFingerprint,
  type NotificationItem,
} from '../lib/notifications'

export function NotificationBell({ user }: { user: AuthUser }) {
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState<NotificationItem[]>([])
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState<string>()
  const identity = notificationIdentity(user.iss, user.sub)

  useEffect(() => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const owner = crypto.randomUUID()
    const ledgerKey = `${identity}:toasts`
    const leaseKey = `${identity}:leader`
    let polling = false
    let countPolling = false
    let toastError = ''
    let countError = ''
    async function count() {
      if (countPolling) return
      countPolling = true
      try {
        const value = await fetchUnreadCount(controller.signal)
        if (!controller.signal.aborted) { setUnread(value); countError = ''; setError(toastError) }
      } catch (err) {
        if (!controller.signal.aborted) { countError = message(err); setError(countError); setToasts([]) }
      } finally { countPolling = false }
    }

    async function collect() {
      const items = await fetchNotificationToasts(controller.signal)
      if (controller.signal.aborted || document.visibilityState !== 'visible') return
      // Persist only opaque IDs, timestamps and group versions, never notification text.
      const parsed: unknown = JSON.parse(localStorage.getItem(ledgerKey) || '[]')
      const seen = Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
      const now = Date.now()
      const fresh = freshToastItems(items, seen, startedAt, now)
      const deferred = deferredToastCount(items, seen, startedAt, now)
      const nextSeen = [...new Set([...seen, ...items.map(toastFingerprint)])].slice(-1000)
      localStorage.setItem(ledgerKey, JSON.stringify(nextSeen))
      // Bursts are summarized with an inbox link, rather than replayed individually.
      if (fresh.length > 3 || deferred > 0) {
        setToasts([{
          id: '', category: 'announcements', title: `${fresh.length + deferred} new notifications`,
          summary: deferred ? 'Activity was deferred or arrived while offline. Open the inbox to review it.' : 'Open the inbox to review your latest activity.', href: '/notifications',
          read: false, count: 1, createdAt: new Date().toISOString(),
        }])
      } else if (fresh.length) {
        setToasts(current => [...current, ...fresh].slice(-3))
      }
    }

    async function toastPoll() {
      if (polling || document.visibilityState !== 'visible') return
      polling = true
      try {
        if (navigator.locks) {
          await navigator.locks.request(`${identity}:toast-poll`, { ifAvailable: true }, async lock => {
            if (!lock) return
            const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null') as { owner: string; expires: number } | null
            if (lease && lease.owner !== owner && lease.expires > Date.now()) return
            localStorage.setItem(leaseKey, JSON.stringify({ owner, expires: Date.now() + 15_000 }))
            await collect()
          })
        } else {
          // Older browsers use a short renewable foreground lease.
          const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null') as { owner: string; expires: number } | null
          if (!lease || lease.expires < Date.now() || lease.owner === owner) {
            localStorage.setItem(leaseKey, JSON.stringify({ owner, expires: Date.now() + 15_000 }))
            await new Promise(resolve => window.setTimeout(resolve, 75))
            const winner = JSON.parse(localStorage.getItem(leaseKey) || 'null') as { owner?: string } | null
            if (winner?.owner === owner) await collect()
          }
        }
        if (!controller.signal.aborted) { toastError = ''; setError(countError) }
      } catch (err) {
        if (!controller.signal.aborted) { toastError = `Online notifications unavailable: ${message(err)}`; setError(toastError) }
      } finally { polling = false }
    }
    const poll = () => { void count(); void toastPoll() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll()
      else {
        setToasts([])
        try {
          const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null') as { owner?: string } | null
          if (lease?.owner === owner) localStorage.removeItem(leaseKey)
        } catch { /* Storage failures are reported by toast polling. */ }
      }
    }
    poll()
    const interval = window.setInterval(() => { setToasts([]); poll() }, 10_000)
    const unsubscribe = subscribeNotificationsChanged(() => { void count(); setToasts([]) })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      try {
        const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null') as { owner?: string } | null
        if (lease?.owner === owner) localStorage.removeItem(leaseKey)
      } catch { /* No storage means no retained lease. */ }
    }
  }, [identity])

  async function markRead(item: NotificationItem) {
    setBusy(item.id)
    setActionError('')
    try {
      await setNotificationRead(item.id, true)
      setToasts(current => current.filter(toast => toast.id !== item.id))
    } catch (err) { setActionError(message(err)) } finally { setBusy(undefined) }
  }

  return (
    <>
      <Link className="icon-round notification-bell" to="/notifications" aria-label={`Notifications, ${unread} unread`} title="Notifications">
        <Bell size={17} aria-hidden="true" />
        {unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
        {error && <span className="notification-failure" aria-hidden="true">!</span>}
      </Link>
      <aside className="notification-toasts" aria-label="Online notifications">
        {error && <details className="notification-toast notification-poll-error">
          <summary>Notifications could not synchronize</summary>
          <p role="alert">{error}</p><Link to="/notifications">Open inbox</Link>
        </details>}
        {actionError && <p className="flash flash-error" role="alert">{actionError}</p>}
        {toasts.map(item => {
          const href = safeNotificationHref(item.href, window.location.origin)
          return <section className="notification-toast" key={item.id || 'summary'}>
            <div role="status" aria-live="polite"><strong>{item.title}</strong><p>{item.summary}</p></div>
            <div className="notification-actions">
              {href && <Link to={href} onClick={() => setToasts(current => current.filter(toast => toast.id !== item.id))}><ArrowUpRight size={14} aria-hidden="true" className="button-label-icon" />View{item.count > 1 ? ` ${item.count} events` : ''}</Link>}
              {item.id && <button className="btn small" type="button" disabled={busy === item.id} onClick={() => void markRead(item)}><Check size={14} aria-hidden="true" />Mark read</button>}
              <button className="icon-round" type="button" aria-label={`Dismiss ${item.title}`} onClick={() => setToasts(current => current.filter(toast => toast.id !== item.id))}><X size={15} /></button>
            </div>
          </section>
        })}
      </aside>
    </>
  )
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'Notification request failed' }
