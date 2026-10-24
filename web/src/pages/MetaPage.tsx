import { ChevronRight as ActionChevronRight, Search as ActionSearch } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MetaPills } from '../components/MetaPills'
import { MetaPanel } from '../components/MetaPanel'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  ENTITY_TYPES,
  fetchEntityOptions,
  fetchMetaHistory,
  searchMeta,
  type MetaTarget,
  type EntityRef,
} from '../lib/meta'

const PLACEHOLDER: Record<string, string> = {
  namespace: 'acme',
  repo: 'acme/data',
  branch: 'acme/data@main',
  commit: 'acme/data#<commit-id>',
  directory: 'acme/data:images/',
  file: 'acme/data:images/a.png',
  workspace: 'acme/data!<workspace-id>',
  job: '<job-id>',
  session: '<session-id>',
}

/** Where the entity itself lives in the UI, when it has a page. */
function entityHref(type: string, id: string, scope?: MetaTarget['scope']): string | null {
  const e = encodeURIComponent
  const [repoPart] = id.split(/[@#:!]/)
  const [ns, repo] = repoPart.split('/')
  switch (type) {
    case 'namespace':
      return `/n/${e(id)}`
    case 'repo':
      return `/n/${e(ns)}/r/${e(repo)}`
    case 'branch':
      return `/n/${e(ns)}/r/${e(repo)}/branches/${e(id.split('@')[1] ?? 'main')}`
    case 'commit':
      return `/n/${e(ns)}/r/${e(repo)}/commits/${e(id.split('#')[1] ?? '')}`
    case 'workspace':
      return `/n/${e(ns)}/r/${e(repo)}/stages/${e(id.split('!')[1] ?? '')}`
    case 'session':
      return `/sessions/${e(id)}`
    case 'file':
    case 'directory': {
      const path = id.slice(id.indexOf(':') + 1).replace(/\/$/, '')
      const view = type === 'file' ? 'blob' : 'tree'
      return `/n/${e(ns)}/r/${e(repo)}/${view}/${e(scope?.id ?? 'main')}/${path.split('/').map(e).join('/')}`
    }
    default:
      return null
  }
}

function History({ type, id, scope }: EntityRef) {
  const st = useAsync((s) => fetchMetaHistory(type, id, s, scope), [type, id, scope?.kind, scope?.id])
  return (
    <section className="meta-panel" aria-label="History">
      <header className="meta-head">
        <h3>History</h3>
      </header>
      <StateBlock
        loading={st.kind === 'loading'}
        error={st.kind === 'error' ? st.message : null}
        empty={st.kind === 'ok' && st.data.length === 0}
        emptyMessage="No changes recorded."
      >
        {st.kind === 'ok' && (
          <table className="meta-history" data-testid="meta-history">
            <thead>
              <tr>
                <th>Rev</th>
                <th>When</th>
                <th>Who</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {st.data.map((h) => (
                <tr key={h.revision}>
                  <td>{h.revision}</td>
                  <td>{new Date(h.ts).toLocaleString()}</td>
                  <td>{h.actor.name || h.actor.email}</td>
                  <td>{h.op === 'delete' ? 'cleared' : 'updated'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </StateBlock>
      <p className="small muted">
        Full details are in the <Link to="/audit?action=meta.set">audit log</Link>.
      </p>
    </section>
  )
}

export function MetaPage() {
  const [params, setParams] = useSearchParams()
  const type = params.get('type') ?? ''
  const id = params.get('id') ?? ''
  const focus = params.get('focus') ?? undefined
  const scopeKind = params.get('scope')
  const scopeRevision = params.get('revision')
  const scope: MetaTarget['scope'] = (scopeKind === 'branch' || scopeKind === 'commit') && scopeRevision
    ? { kind: scopeKind, id: scopeRevision }
    : undefined
  const targetKey = `${type}:${id}:${scopeKind}:${scopeRevision}`
  const [historyTarget, setHistoryTarget] = useState<{ key: string; scope: MetaTarget['scope']; ready: boolean } | null>(null)
  const selectedHistory = historyTarget?.key === targetKey ? historyTarget : {
    scope,
    ready: true,
  }
  const [q, setQ] = useState(params.get('q') ?? '')
  const [draftType, setDraftType] = useState(type)
  const [draftId, setDraftId] = useState(id)
  const [tag, setTag] = useState(params.get('tag') ?? '')

  // Search always reflects the active filters; with none it lists the latest entries.
  const filterKey = new URLSearchParams(
    [...params.entries()].filter(([k]) => ['q', 'type', 'tag', 'cursor'].includes(k)),
  ).toString()
  const search = useAsync(
    (signal) => searchMeta(new URLSearchParams(filterKey), signal),
    [filterKey],
  )
  const data = search.kind === 'ok' ? search.data : null

  const options = useAsync(
    (sig) => (draftType ? fetchEntityOptions(draftType, sig) : Promise.resolve([] as string[])),
    [draftType],
  )
  const known = options.kind === 'ok' ? options.data : []

  function apply(e: FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    const typedId = draftId.trim()
    if (draftType && typedId) {
      p.set('type', draftType)
      p.set('id', typedId)
    } else {
      if (draftType) p.set('type', draftType)
      if (q) p.set('q', q)
      if (tag) p.set('tag', tag)
    }
    setParams(p)
  }

  const href = id ? entityHref(type, id, selectedHistory.scope) : null

  return (
    <section className="page">
      <h1>Metadata</h1>
      <form className="audit-filters" onSubmit={apply}>
        <label>
          Type
          <select
            name="type"
            value={draftType}
            onChange={(e) => {
              setDraftType(e.target.value)
              setDraftId('')
            }}
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {draftType && (
          <>
            <label>
              Choose {draftType}
              <select
                name="pick"
                value={known.includes(draftId) ? draftId : ''}
                onChange={(e) => {
                  setDraftId(e.target.value)
                  if (e.target.value) setParams({ type: draftType, id: e.target.value })
                }}
              >
                <option value="">
                  {options.kind === 'loading' ? 'Loading…' : known.length ? 'Select…' : 'None found'}
                </option>
                {known.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label>
              or enter ID
              <input
                name="id"
                value={draftId}
                placeholder={PLACEHOLDER[draftType]}
                onChange={(e) => setDraftId(e.target.value)}
              />
            </label>
          </>
        )}
        <label style={{ gridColumn: 'span 2' }}>
          Search
          <input
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="text, tag:x, label.env:prod"
          />
        </label>
        <label>
          Tag
          <select name="tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All</option>
            {tag && !data?.facets.tags[tag] && <option>{tag}</option>}
            {Object.entries(data?.facets.tags ?? {}).map(([t, n]) => (
              <option key={t} value={t}>
                {t} ({n})
              </option>
            ))}
          </select>
        </label>
        <div className="audit-filter-actions">
          <button className="btn primary" type="submit">
            <ActionSearch size={14} aria-hidden="true" className="button-label-icon" />Search
          </button>
        </div>
      </form>

      {id ? (
        <>
          <div className="meta-entity-title">
            <h2>
              <span className="pill">{type}</span>{' '}
              {href ? (
                <Link to={href} className="mono" title={`Open ${type}`}>
                  {id}
                </Link>
              ) : (
                <span className="mono">{id}</span>
              )}
            </h2>
            <Link to="/meta" className="small meta-entity-back">
              Back
            </Link>
          </div>
          <MetaPanel key={targetKey} type={type} id={id} scope={scope} focus={focus} defaultOpen onScopeChange={(next, ready) => setHistoryTarget({ key: targetKey, scope: next, ready })} />
          {selectedHistory.ready && <History type={type as EntityRef['type']} id={id} scope={selectedHistory.scope} />}
        </>
      ) : (
        <>
          <h2 className="meta-list-title">
            {filterKey.replace(/cursor=[^&]*&?/, '') ? 'Results' : 'Latest metadata'}
            {data ? <span className="muted small"> · {data.total}</span> : null}
          </h2>
          {data && !data.coverage.complete && <p className="small muted">Partial coverage: {data.coverage.description}</p>}
          <StateBlock
            loading={search.kind === 'loading'}
            error={search.kind === 'error' ? search.message : null}
            empty={!!data && data.hits.length === 0}
            emptyMessage="No metadata yet. Open an entity page to add some."
            onRetry={search.reload}
          >
            {data && (
              <table className="table" data-testid="meta-results">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Metadata</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hits.map((h) => (
                    <tr key={h.url}>
                      <td>
                        <Link to={h.url}>{h.name}</Link>
                      </td>
                      <td>{h.ref.type}{h.ref.scope ? ` · ${h.ref.scope.kind}: ${h.ref.scope.id}` : ''}</td>
                      <td>
                        <MetaPills type={h.ref.type} id={h.ref.id} scope={h.ref.scope} meta={h.effective} />
                      </td>
                      <td className="small muted">
                        {h.updatedAt ? new Date(h.updatedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </StateBlock>
          {data?.nextCursor && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                const p = new URLSearchParams(filterKey)
                p.set('cursor', data.nextCursor ?? '')
                setParams(p)
              }}
            >
              <ActionChevronRight size={14} aria-hidden="true" className="button-label-icon" />Next page
            </button>
          )}
        </>
      )}
    </section>
  )
}
