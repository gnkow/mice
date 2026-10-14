import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAudit, type AuditEvent } from '../lib/audit'

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function RepoCell({ event }: { event: AuditEvent }) {
  if (!event.namespace || !event.repo) {
    return <span className="muted">—</span>
  }
  return (
    <Link to={`/n/${encodeURIComponent(event.namespace)}/r/${encodeURIComponent(event.repo)}`}>
      {event.namespace}/{event.repo}
    </Link>
  )
}

export function AuditPage() {
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState({
    actor: params.get('actor') ?? '',
    namespace: params.get('namespace') ?? '',
    repo: params.get('repo') ?? '',
    action: params.get('action') ?? '',
  })

  const queryKey = useMemo(
    () => ({
      actor: params.get('actor') || undefined,
      namespace: params.get('namespace') || undefined,
      repo: params.get('repo') || undefined,
      action: params.get('action') || undefined,
      limit: 100,
    }),
    [params],
  )

  const state = useAsync(
    (signal) => fetchAudit(queryKey, signal),
    [queryKey.actor, queryKey.namespace, queryKey.repo, queryKey.action],
  )

  function onFilter(e: FormEvent) {
    e.preventDefault()
    const next = new URLSearchParams()
    if (draft.actor.trim()) next.set('actor', draft.actor.trim())
    if (draft.namespace.trim()) next.set('namespace', draft.namespace.trim())
    if (draft.repo.trim()) next.set('repo', draft.repo.trim())
    if (draft.action.trim()) next.set('action', draft.action.trim())
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setDraft({ actor: '', namespace: '', repo: '', action: '' })
    setParams({}, { replace: true })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Audit</h1>
          <p className="lede">
            Append-only log of mutations through the auth BFF (who / what / when
            / which repo).
          </p>
        </div>
      </div>

      <form className="audit-filters" onSubmit={onFilter}>
        <label>
          Actor
          <input
            name="actor"
            value={draft.actor}
            onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
            placeholder="email, name, or sub"
          />
        </label>
        <label>
          Namespace
          <input
            name="namespace"
            value={draft.namespace}
            onChange={(e) =>
              setDraft((d) => ({ ...d, namespace: e.target.value }))
            }
            placeholder="namespace"
          />
        </label>
        <label>
          Repo
          <input
            name="repo"
            value={draft.repo}
            onChange={(e) => setDraft((d) => ({ ...d, repo: e.target.value }))}
            placeholder="repo"
          />
        </label>
        <label>
          Action
          <input
            name="action"
            value={draft.action}
            onChange={(e) =>
              setDraft((d) => ({ ...d, action: e.target.value }))
            }
            placeholder="file.write, merge, …"
          />
        </label>
        <div className="audit-filter-actions">
          <button type="submit" className="btn primary">
            Filter
          </button>
          <button type="button" className="btn ghost" onClick={clearFilters}>
            Clear
          </button>
        </div>
      </form>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && state.data.events.length === 0}
        emptyMessage="No audit events match these filters."
      >
        {state.kind === 'ok' && (
          <div className="branches-table-wrap">
            <table className="branches-table audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Via</th>
                  <th>Action</th>
                  <th>Repo</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {state.data.events.map((ev) => (
                  <tr key={ev.id} data-audit-id={ev.id}>
                    <td className="mono small">{formatTs(ev.ts)}</td>
                    <td>
                      <div>{ev.actor.name}</div>
                      <div className="muted small">{ev.actor.email}</div>
                    </td>
                    <td className="mono small">{ev.via}</td>
                    <td className="mono small">{ev.action}</td>
                    <td>
                      <RepoCell event={ev} />
                    </td>
                    <td className="mono small">{ev.status}</td>
                    <td className="small">
                      {ev.message || (
                        <span className="muted">
                          {typeof ev.detail?.path === 'string'
                            ? ev.detail.path
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateBlock>
    </main>
  )
}
