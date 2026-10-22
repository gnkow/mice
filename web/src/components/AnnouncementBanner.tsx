import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  dismissalKey,
  listAnnouncements,
  loadDismissed,
  saveDismissed,
  type Announcement,
  type AnnouncementSeverity,
} from '../lib/announcements'

const ICONS: Record<AnnouncementSeverity, typeof Info> = { info: Info, warning: AlertTriangle, critical: OctagonAlert }
const REFRESH_MS = 5 * 60_000

/** Instance announcements shown to signed-in users; each can be dismissed per browser. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listAnnouncements()
        .then((rows) => { if (!cancelled) setItems(rows) })
        .catch(() => { /* banner is best-effort */ })
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const dismiss = useCallback((a: Announcement) => {
    setDismissed((prev) => {
      const next = [...prev, dismissalKey(a)]
      saveDismissed(next)
      return next
    })
  }, [])

  const visible = items.filter((a) => !dismissed.includes(dismissalKey(a)))
  if (visible.length === 0) return null
  return (
    <div className="announcements" role="region" aria-label="Announcements">
      {visible.map((a) => {
        const Icon = ICONS[a.severity]
        return (
          <div key={a.id} className={`announcement announcement-${a.severity}`} role={a.severity === 'critical' ? 'alert' : 'status'}>
            <Icon size={16} aria-hidden="true" className="announcement-icon" />
            <div className="announcement-body">
              <strong>{a.title}</strong>
              {a.message ? <span className="announcement-message">{a.message}</span> : null}
            </div>
            <button type="button" className="announcement-dismiss" onClick={() => dismiss(a)} aria-label={`Dismiss announcement: ${a.title}`}>
              <X size={14} aria-hidden="true" className="button-label-icon" />Dismiss
            </button>
          </div>
        )
      })}
    </div>
  )
}

