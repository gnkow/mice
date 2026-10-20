import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { confirmDelete } from '../lib/confirmDelete'
import { deleteNamespaceAuthz, listAuthzNamespaces } from '../lib/authzApi'
import { loadCatalog } from '../lib/catalog'
import {
  mergeNamespaces,
  type MergedNamespace,
} from '../lib/mergeNamespaces'

export function NamespacesListPage() {
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const authzNs = useAsync((signal) => listAuthzNamespaces(signal), [])
  const me = useAsync((signal) => fetchAuthzMe(signal), [])
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyNs, setBusyNs] = useState<string | null>(null)

  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const canCreate =
    me.kind === 'ok' &&
    me.data &&
    (me.data.instanceAdmin || me.data.permissions.create_namespace)

  const merged = useMemo(() => {
    const oxen = catalog.kind === 'ok' ? catalog.data.namespaces : []
    const authz = authzNs.kind === 'ok' ? authzNs.data.namespaces : []
    return mergeNamespaces(oxen, authz)
  }, [catalog, authzNs])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return merged
    return merged.filter((ns) => ns.name.toLowerCase().includes(q))
  }, [merged, filter])

  const slice = paginate(filtered, page, PAGE_SIZE)
  const loading = catalog.kind === 'loading' || authzNs.kind === 'loading'
  const error =
    catalog.kind === 'error'
      ? catalog.message
      : authzNs.kind === 'error'
        ? authzNs.message
        : null

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

  const isAdmin = me.kind === 'ok' && !!me.data?.instanceAdmin

  async function onRemove(ns: MergedNamespace) {
    if (
      !(await confirmDelete({
        title: `Delete namespace ${ns.name}`,
        detail:
          'All repositories in this namespace will be deleted from oxen-server, and AuthZ membership will be removed.',
        confirmWord: ns.name,
      }))
    ) {
      return
    }
    setBusyNs(ns.name)
    setActionError(null)
    try {
      await deleteNamespaceAuthz(ns.name, { deleteRepositories: true })
      catalog.reload()
      authzNs.reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyNs(null)
    }
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Namespaces</h1>
          <p className="lede">
            Organize repositories and access. Empty namespaces (AuthZ only) show
            until the first repository is created on oxen-server.
          </p>
        </div>
        {canCreate && (
          <div className="btn-row">
            <Link className="btn primary" to="/namespaces/new">
              + New namespace
            </Link>
          </div>
        )}
      </div>

      <div className="ns-toolbar">
        <div className="ns-search-field">
          <label className="ns-search-label" htmlFor="ns-filter">
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
              id="ns-filter"
              type="search"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter by name"
              autoComplete="off"
            />
            {filter.trim() ? (
              <button
                type="button"
                className="ns-search-clear"
                onClick={() => onFilterChange('')}
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {!loading && (
          <p className="muted small ns-toolbar-meta">
            {filtered.length} namespace{filtered.length === 1 ? '' : 's'}
            {filter.trim() ? ' matching' : ''}
          </p>
        )}
      </div>

      {actionError && <p className="flash flash-error" role="status">{actionError}</p>}

      <StateBlock
        loading={loading}
        error={error}
        onRetry={() => {
          catalog.reload()
          authzNs.reload()
        }}
        empty={!loading && !error && filtered.length === 0}
        emptyMessage={
          filter.trim()
            ? `No namespaces match “${filter.trim()}”.`
            : canCreate
              ? 'No namespaces yet. Create a namespace to set access before adding repositories.'
              : 'No namespaces yet. Ask an admin for access, or create a repository if you have permission.'
        }
      >
        {!loading && !error && (
          <>
            <ul className="ns-card-list">
              {slice.items.map((ns) => {
                const canDelete =
                  !!ns.authz && (ns.authz.role === 'owner' || isAdmin)
                return (
                  <li key={ns.name}>
                    <article className="ns-card">
                      <div className="ns-card-main">
                        <Link
                          className="ns-card-title"
                          to={`/n/${encodeURIComponent(ns.name)}`}
                        >
                          {ns.name}
                        </Link>
                        <p className="ns-card-meta muted small">
                          {ns.repoCount === 1
                            ? '1 repository'
                            : `${ns.repoCount} repositories`}
                          {ns.workspaceCount > 0 &&
                            ` · ${ns.workspaceCount} workspace${ns.workspaceCount === 1 ? '' : 's'}`}
                          {ns.onOxen
                            ? ` · ${ns.storageGb.toFixed(3)} GB`
                            : ' · not on oxen yet'}
                        </p>
                        <div className="ns-card-tags">
                          {!ns.onOxen && (
                            <span className="ns-tag ns-tag-muted">Empty</span>
                          )}
                          {ns.authz && (
                            <>
                              <span className="ns-tag">
                                base: {ns.authz.basePermission}
                              </span>
                              <span className="ns-tag">
                                {ns.authz.memberCount} member
                                {ns.authz.memberCount === 1 ? '' : 's'}
                              </span>
                              {ns.authz.role && (
                                <span className="ns-tag ns-tag-accent">
                                  you: {ns.authz.role}
                                </span>
                              )}
                            </>
                          )}
                          {!ns.authz && ns.onOxen && (
                            <span className="ns-tag ns-tag-warn">
                              no AuthZ record
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ns-card-actions">
                        {ns.authz && (
                          <Link
                            className="btn ghost small"
                            to={`/n/${encodeURIComponent(ns.name)}/settings`}
                          >
                            Settings
                          </Link>
                        )}
                        <Link
                          className="btn primary small ns-card-new-repo"
                          to={`/repos/new?namespace=${encodeURIComponent(ns.name)}`}
                        >
                          <span className="ns-card-new-repo-icon" aria-hidden>
                            +
                          </span>
                          New repository
                        </Link>
                        {canDelete && (
                          <button
                            type="button"
                            className="btn danger small"
                            disabled={busyNs === ns.name}
                            onClick={() => void onRemove(ns)}
                          >
                            {busyNs === ns.name ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </article>
                  </li>
                )
              })}
            </ul>
            <Pagination
              page={slice.page}
              pageCount={slice.pageCount}
              onPageChange={goPage}
              label="Namespaces pages"
              total={slice.total}
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
