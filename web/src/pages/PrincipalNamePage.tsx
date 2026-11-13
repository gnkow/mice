import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { nameHistoryDayLabel } from '../lib/signatureName'

type NameRow = { name: string; validFrom: string; validTo: string | null }

/** Stored name timeline for one Principal. */
export function PrincipalNamePage() {
  const [params] = useSearchParams()
  const iss = params.get('iss') ?? ''
  const sub = params.get('sub') ?? ''
  const [history, setHistory] = useState<NameRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!iss || !sub) {
      setError('Principal required')
      return
    }
    const query = new URLSearchParams({ iss, sub })
    let cancel = false
    void fetch(`/auth/admin/principals/names?${query}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = await res.json() as { error?: string; history?: NameRow[] }
        if (!res.ok) throw new Error(body.error || 'Failed to load name history')
        if (!cancel) setHistory(body.history ?? [])
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Failed to load name history')
      })
    return () => { cancel = true }
  }, [iss, sub])

  return (
    <section className="settings-section" aria-labelledby="principal-names-heading">
      <h2 id="principal-names-heading">Name history</h2>
      <p className="muted small">{iss} · {sub}</p>
      <p><Link to="/settings">Back to settings</Link></p>
      {error && <p className="error">{error}</p>}
      {history.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Valid from</th>
              <th>Valid to</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={`${row.validFrom}-${row.name}`}>
                <td>{row.name}</td>
                <td>{nameHistoryDayLabel(row.validFrom)}</td>
                <td>{nameHistoryDayLabel(row.validTo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
