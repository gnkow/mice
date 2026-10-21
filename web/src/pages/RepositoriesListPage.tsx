import { FolderGit2 as ActionFolderGit2, Trash2 as ActionTrash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'

export function RepositoriesListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return []
    const q = filter.trim().toLowerCase()
    if (!q) return state.data.repositories
    return state.data.repositories.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q),
    )
  }, [state, filter])

  const slice = paginate(filtered, page, PAGE_SIZE)

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  function onFilterChange(value: string) {
    setFilter(value)
    const nextParams = new URLSearchParams(params)
    if (value.trim()) nextParams.set('q', value.trim())
    else nextParams.delete('q')
    nextParams.delete('page')
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Repositories</h1>
          <p className="lede">All repositories across namespaces.</p>
        </div>
        <div className="btn-row">
          <Link className="btn primary" to="/repos/new">
            <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />New repository
          </Link>
        </div>
      </div>

      <div className="ns-toolbar">
        <div className="ns-search-field">
          <label className="ns-search-label" htmlFor="repo-filter">
            Search
          </label>
          <div className="ns-search-control">
            <span className="ns-search-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              id="repo-filter"
              type="search"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter by name or namespace"
              autoComplete="off"
            />
            {filter.trim() ? (
              <button
                type="button"
                className="ns-search-clear"
                onClick={() => onFilterChange('')}
                aria-label="Clear search"
              >
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
              </button>
            ) : null}
          </div>
        </div>
        {state.kind === 'ok' && (
          <p className="muted small ns-toolbar-meta">
            {filtered.length} repositor{filtered.length === 1 ? 'y' : 'ies'}
            {filter.trim() ? ' matching' : ''}
          </p>
        )}
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && filtered.length === 0}
        emptyMessage={
          filter.trim()
            ? `No repositories match "${filter.trim()}".`
            : 'No repositories yet. Create one to get started.'
        }
      >
        {state.kind === 'ok' && (
          <>
            <ul className="card-list">
              {slice.items.map((p) => (
                <li key={`${p.namespace}/${p.name}`}>
                  <RepoSummaryCard
                    namespace={p.namespace}
                    name={p.name}
                    showNamespace
                    onDeleted={() => state.reload()}
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={slice.page}
              pageCount={slice.pageCount}
              onPageChange={goPage}
              label="Repositories pages"
              total={slice.total}
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
