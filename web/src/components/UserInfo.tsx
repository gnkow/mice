import { useEffect, useState } from 'react'
import { decideNameHistoryRowDisplay } from '../lib/signatureName'

type NameRow = { name: string; validFrom: string; validTo: string | null }

type HistoryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: ReturnType<typeof decideNameHistoryRowDisplay>[] }

/** Detail panel for a Principal / commit author. */
export function UserInfo({
  name,
  username,
  email,
  iss,
  sub,
  currentEmail,
}: {
  name?: string | null
  username?: string | null
  email?: string | null
  iss?: string | null
  sub?: string | null
  currentEmail?: string | null
}) {
  const [history, setHistory] = useState<HistoryState>({ kind: 'idle' })

  useEffect(() => {
    if (!iss || !sub) {
      setHistory({ kind: 'idle' })
      return
    }
    const query = new URLSearchParams({ iss, sub })
    const controller = new AbortController()
    setHistory({ kind: 'loading' })
    void fetch(`/auth/admin/principals/names?${query}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setHistory({ kind: 'unavailable' })
          return
        }
        const body = (await res.json()) as {
          error?: string
          history?: NameRow[]
        }
        if (!res.ok) throw new Error(body.error || 'Failed to load name history')
        const rows = (body.history ?? []).map(decideNameHistoryRowDisplay)
        setHistory(rows.length === 0 ? { kind: 'empty' } : { kind: 'ok', rows })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setHistory({ kind: 'unavailable' })
      })
    return () => controller.abort()
  }, [iss, sub])

  return (
    <div className="user-info" data-testid="user-info" role="dialog" aria-label="User details">
      <dl className="user-info-list">
        {name ? (
          <div className="user-info-row">
            <dt>Name</dt>
            <dd data-testid="user-info-name">{name}</dd>
          </div>
        ) : null}
        {username ? (
          <div className="user-info-row">
            <dt>Username</dt>
            <dd data-testid="user-info-username">{username}</dd>
          </div>
        ) : null}
        {email ? (
          <div className="user-info-row">
            <dt>Email</dt>
            <dd data-testid="commit-email" data-source="stored">
              <span className="mono">{email}</span>
              {currentEmail && currentEmail !== email ? (
                <span
                  className="muted small commit-email-current"
                  data-testid="commit-email-current"
                >
                  {' '}
                  (current: {currentEmail})
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {iss ? (
          <div className="user-info-row">
            <dt>Issuer</dt>
            <dd className="mono user-info-break" data-testid="user-info-iss">
              {iss}
            </dd>
          </div>
        ) : null}
        {sub ? (
          <div className="user-info-row">
            <dt>Subject</dt>
            <dd className="mono user-info-break" data-testid="user-info-sub">
              {sub}
            </dd>
          </div>
        ) : null}
      </dl>

      {iss && sub && history.kind !== 'idle' && history.kind !== 'unavailable' ? (
        <div
          className="user-info-name-history"
          data-testid="user-info-name-history"
          aria-busy={history.kind === 'loading' || undefined}
        >
          <p className="user-info-name-history-label">Name history</p>
          {history.kind === 'loading' ? (
            <p className="muted small" role="status">
              Loading…
            </p>
          ) : null}
          {history.kind === 'empty' ? (
            <p className="muted small" role="status" data-testid="user-info-name-history-empty">
              No name changes recorded yet.
            </p>
          ) : null}
          {history.kind === 'ok' ? (
            <ol className="user-info-name-history-list">
              {history.rows.map((row) => (
                <li
                  key={`${row.fromDay}-${row.name}`}
                  data-current={row.isCurrent ? 'true' : undefined}
                >
                  <span className="user-info-name-history-name">
                    {row.name}
                    {row.isCurrent ? (
                      <span className="muted small"> (current)</span>
                    ) : null}
                  </span>
                  <span className="muted small">
                    {row.isCurrent
                      ? `since ${row.fromDay}`
                      : `${row.fromDay} → ${row.toDay}`}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
