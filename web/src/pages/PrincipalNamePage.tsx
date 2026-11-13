import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { decideNameHistoryRowDisplay } from '../lib/signatureName'

type NameRow = { name: string; validFrom: string; validTo: string | null }

/** Stored name timeline for one Principal (Ticket 47). Oldest first; no IdP lookup. */
export function PrincipalNamePage() {
  const [params] = useSearchParams()
  const iss = params.get('iss') ?? ''
  const sub = params.get('sub') ?? ''
  const [history, setHistory] = useState<NameRow[]>([])
  const [currentName, setCurrentName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!iss || !sub) {
      setError('Principal required')
      setLoading(false)
      return
    }
    const query = new URLSearchParams({ iss, sub })
    let cancel = false
    setLoading(true)
    void fetch(`/auth/admin/principals/names?${query}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json()) as {
          error?: string
          history?: NameRow[]
          currentName?: string | null
        }
        if (!res.ok) throw new Error(body.error || 'Failed to load name history')
        if (!cancel) {
          setHistory(body.history ?? [])
          setCurrentName(body.currentName ?? null)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Failed to load name history')
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [iss, sub])

  const rows = history.map(decideNameHistoryRowDisplay)

  return (
    <section
      className="settings-section"
      aria-labelledby="principal-names-heading"
      data-testid="principal-name-history"
    >
      <h2 id="principal-names-heading">Name history</h2>
      <p className="muted small">
        Stored timeline for this Principal (oldest first). Mice does not ask the IdP for this page.
      </p>
      <p className="muted small mono" aria-label="Principal identity">
        {iss} · {sub}
      </p>
      <p>
        <Link to="/settings">Back to settings</Link>
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && !error && (
        <p className="muted" aria-live="polite">
          Loading name history…
        </p>
      )}

      {!loading && !error && currentName && (
        <p className="muted small" data-testid="principal-current-name">
          Current name: <strong>{currentName}</strong>
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="muted" role="status">
          No name history recorded yet.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="table-container">
          <table className="table" aria-describedby="principal-names-heading">
            <caption className="muted small">
              Chronological name intervals (oldest first)
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Valid from</th>
                <th scope="col">Valid to</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.fromDay}-${row.name}`}
                  data-current={row.isCurrent ? 'true' : undefined}
                >
                  <td>
                    {row.name}
                    {row.isCurrent ? (
                      <span className="muted small"> (current)</span>
                    ) : null}
                  </td>
                  <td>
                    <time dateTime={row.fromDay}>{row.fromDay}</time>
                  </td>
                  <td>
                    {row.isCurrent ? (
                      <span aria-label="still current">current</span>
                    ) : (
                      <time dateTime={row.toDay}>{row.toDay}</time>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
