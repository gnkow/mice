import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'

export function NamespacesListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const slice =
    state.kind === 'ok'
      ? paginate(state.data.namespaces, page, PAGE_SIZE)
      : null

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Namespaces</h1>
          <p className="lede">All namespaces on this oxen-server.</p>
        </div>
        <Link className="btn primary" to="/repos/new">
          + New project
        </Link>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && state.data.namespaces.length === 0}
        emptyMessage="No namespaces yet. Create a project to create one."
      >
        {state.kind === 'ok' && slice && (
          <>
            <ul className="card-list">
              {slice.items.map((ns) => (
                <li key={ns.namespace}>
                  <Link
                    className="repo-summary-card"
                    to={`/n/${encodeURIComponent(ns.namespace)}`}
                  >
                    <span className="repo-summary-main">
                      <span className="card-title">{ns.namespace}</span>
                      <span className="card-meta">
                        {ns.repoCount} project{ns.repoCount === 1 ? '' : 's'}
                        {ns.workspaceCount > 0 &&
                          ` · ${ns.workspaceCount} workspace${ns.workspaceCount === 1 ? '' : 's'}`}
                        {' · '}
                        {ns.storageGb.toFixed(3)} GB
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination
              page={slice.page}
              pageCount={slice.pageCount}
              onPageChange={goPage}
              label="Namespaces pages"
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
