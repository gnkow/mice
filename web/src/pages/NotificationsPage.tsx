import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Bell, CheckCheck, ChevronDown, Mail, MailOpen, RefreshCw, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  fetchNotifications, markNotificationsRead, safeNotificationHref, setNotificationRead,
  subscribeNotificationsChanged, type NotificationItem,
} from '../lib/notifications'

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string>()
  const [cutoff, setCutoff] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const pages = useRef(1)
  const generation = useRef(0)
  const fetching = useRef(false)
  const queued = useRef(false)
  const mutation = useRef(false)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(async (loadMore = false, signal?: AbortSignal) => {
    if (mutation.current) return
    if (fetching.current) { queued.current = true; return }
    fetching.current = true
    const currentGeneration = generation.current
    setLoading(true)
    try {
      let cursor: string | undefined
      let combined: NotificationItem[] = []
      let count = 0
      let snapshot = ''
      let loadedPages = 0
      const targetPages = pages.current + (loadMore ? 1 : 0)
      for (let page = 0; page < targetPages; page++) {
        const data = await fetchNotifications({ cursor, unread: unreadOnly, signal })
        combined = [...combined, ...data.items]
        cursor = data.nextCursor
        count = data.unreadCount
        if (!snapshot) snapshot = data.cutoff
        loadedPages++
        if (!cursor) break
      }
      if (signal?.aborted || currentGeneration !== generation.current) return
      setItems([...new Map(combined.map(item => [item.id, item])).values()])
      setUnreadCount(count)
      setNextCursor(cursor)
      setCutoff(snapshot)
      pages.current = loadedPages
      setError('')
    } catch (err) {
      if (!signal?.aborted && currentGeneration === generation.current) {
        setError(err instanceof Error ? err.message : 'Could not load notifications')
        // Never leave a potentially access-revoked summary visible after refresh fails.
        setItems([])
        setNextCursor(undefined)
        setCutoff('')
      }
    } finally {
      fetching.current = false
      if (!signal?.aborted && currentGeneration === generation.current) setLoading(false)
      if (queued.current) { queued.current = false; setRevision(value => value + 1) }
    }
  }, [unreadOnly])

  useEffect(() => {
    const controller = new AbortController()
    const poll = () => { void refresh(false, controller.signal) }
    poll()
    const timer = window.setInterval(poll, 10_000)
    const unsubscribe = subscribeNotificationsChanged(poll)
    return () => { controller.abort(); window.clearInterval(timer); unsubscribe() }
  }, [refresh, revision])

  function filter(unread: boolean) {
    generation.current++
    pages.current = 1
    setItems([])
    setNextCursor(undefined)
    setCutoff('')
    setUnreadOnly(unread)
  }

  async function mutate(action: () => Promise<void>) {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setActionError('')
    generation.current++
    try { await action() } catch (err) { setActionError(err instanceof Error ? err.message : 'Could not update notifications') }
    finally {
      mutation.current = false
      setBusy(false)
      setRevision(value => value + 1)
    }
  }

  const groups = new Map<string, NotificationItem[]>()
  for (const item of items) {
    const date = new Date(item.createdAt)
    const label = Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Earlier'
    groups.set(label, [...(groups.get(label) || []), item])
  }

  return <main className="page notification-page">
    <div className="page-head">
      <div><h1><Bell className="button-label-icon" aria-hidden="true" />Notifications</h1><p className="lede">{unreadCount} unread · Activity is retained for 90 days.</p></div>
      <Link className="btn" to="/profile"><Settings size={16} aria-hidden="true" />Preferences</Link>
    </div>
    <div className="notification-toolbar">
      <label><input type="checkbox" checked={unreadOnly} disabled={loading || busy} onChange={event => filter(event.target.checked)} /> Unread only</label>
      <button className="btn" type="button" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
      <button className="btn" type="button" disabled={loading || busy || !cutoff || !unreadCount} onClick={() => void mutate(() => markNotificationsRead(cutoff))}><CheckCheck size={15} aria-hidden="true" />Mark all read</button>
    </div>
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    {actionError && <p className="flash flash-error" role="alert">{actionError}</p>}
    {loading && <p role="status">Loading notifications…</p>}
    {!loading && !error && !items.length && <p className="notification-empty">No {unreadOnly ? 'unread ' : ''}notifications.</p>}
    {[...groups].map(([label, entries]) => <section className="notification-group" key={label}>
      <h2>{label}</h2>
      <ul className="notification-list">{entries.map(item => {
        const href = safeNotificationHref(item.href, window.location.origin)
        return <li className={`notification-entry${item.read ? '' : ' is-unread'}`} key={item.id}>
          <Bell size={18} aria-hidden="true" className="notification-entry-icon" />
          <div className="notification-entry-content">
            <div className="notification-entry-heading"><strong>{item.title}</strong>{!item.read && <span className="pill">Unread</span>}{item.count > 1 && <span className="pill">{item.count} events</span>}</div>
            <p>{item.summary}</p>
            <p className="muted small">{item.category} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></p>
            {href && <Link to={href}><ArrowUpRight size={14} aria-hidden="true" className="button-label-icon" />View activity</Link>}
          </div>
          <button className="btn small" disabled={busy || loading} type="button" aria-label={`Mark ${item.title} ${item.read ? 'unread' : 'read'}`} onClick={() => void mutate(() => setNotificationRead(item.id, !item.read))}>
            {item.read ? <Mail size={15} aria-hidden="true" /> : <MailOpen size={15} aria-hidden="true" />}Mark {item.read ? 'unread' : 'read'}
          </button>
        </li>
      })}</ul>
    </section>)}
    {nextCursor && <button className="btn" type="button" disabled={loading || busy} onClick={() => void refresh(true)}><ChevronDown size={16} aria-hidden="true" />Load more</button>}
    <p className="muted small">Grouped activity shows its event count; new activity in a group becomes unread again. Mark all read uses the last inbox snapshot cutoff, so newer activity remains unread. Resource links still require current access.</p>
  </main>
}
