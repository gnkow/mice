import { Megaphone, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  SEVERITY_LABELS,
  createAnnouncement,
  deleteAnnouncement,
  isExpired,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementSeverity,
} from '../lib/announcements'

/** Instance admins publish announcements shown as a banner to every signed-in user. */
export function AnnouncementsSection() {
  const state = useAsync((signal) => listAnnouncements({ all: true, signal }), [])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    await run(async () => {
      await createAnnouncement({
        title: title.trim(),
        message: message.trim(),
        severity,
        expiresAt: expires ? new Date(expires).toISOString() : null,
      })
      setTitle('')
      setMessage('')
      setExpires('')
      setSeverity('info')
    })
  }

  const rows = state.kind === 'ok' ? state.data : []

  return (
    <section id="announcements" className="settings-section" aria-labelledby="announcements-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="announcements-heading"><Megaphone size={18} className="button-label-icon" aria-hidden="true" />Announcements</h2>
          <p className="muted small">
            Shown as a banner to every signed-in user until it expires or is hidden. Users can dismiss it in their browser.
          </p>
        </div>
      </div>
      {error && <p className="flash flash-error" role="status">{error}</p>}
      <form className="ns-member-form announcements-form" onSubmit={onCreate}>
        <div className="ns-settings-grid">
          <label className="ns-settings-field">
            <span className="ns-settings-label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Scheduled maintenance" />
          </label>
          <label className="ns-settings-field">
            <span className="ns-settings-label">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}>
              {(Object.keys(SEVERITY_LABELS) as AnnouncementSeverity[]).map((s) => (
                <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="ns-settings-field">
            <span className="ns-settings-label">Expires (optional)</span>
            <input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        </div>
        <label className="ns-settings-field announcement-message-field">
          <span className="ns-settings-label">Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="Details shown under the title" />
        </label>
        <div className="btn-row ns-settings-actions">
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
            <Plus size={14} aria-hidden="true" className="button-label-icon" />Publish announcement
          </button>
        </div>
      </form>

      <h3 className="ns-settings-subhead">Existing announcements</h3>
      {state.kind === 'loading' && <p className="muted small">Loading…</p>}
      {state.kind === 'error' && <p className="flash flash-error" role="status">{state.message}</p>}
      {state.kind === 'ok' && rows.length === 0 && <p className="muted small">No announcements yet.</p>}
      {rows.length > 0 && (
        <ul className="ns-member-list">
          {rows.map((a) => {
            const expired = isExpired(a)
            return (
              <li key={a.id} className="ns-member-row" data-announcement={a.id}>
                <div className="ns-member-main">
                  <span>
                    <strong>{a.title}</strong>{' '}
                    <span className={`ns-tag announcement-tag-${a.severity}`}>{SEVERITY_LABELS[a.severity]}</span>{' '}
                    {expired ? <span className="ns-tag">Expired</span> : !a.active ? <span className="ns-tag">Hidden</span> : <span className="ns-tag ns-tag-accent">Live</span>}
                  </span>
                  {a.message ? <span className="muted small">{a.message}</span> : null}
                  <span className="muted small">
                    By {a.createdBy} · {new Date(a.createdAt).toLocaleString()}
                    {a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleString()}` : ''}
                  </span>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => void run(() => updateAnnouncement(a.id, { active: !a.active }))}
                  >
                    {a.active
                      ? <><EyeOff size={14} aria-hidden="true" className="button-label-icon" />Hide</>
                      : <><Eye size={14} aria-hidden="true" className="button-label-icon" />Show</>}
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete announcement "${a.title}"?`)) void run(() => deleteAnnouncement(a.id))
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" className="button-label-icon" />Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
