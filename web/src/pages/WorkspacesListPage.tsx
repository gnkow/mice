import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'

export function WorkspacesListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const slice =
    state.kind === 'ok'
      ? paginate(state.data.workspaces, page, PAGE_SIZE)
      : null

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide workspaces-page">
      <div className="workspaces-page-head">
        <div>
          <h1 className="workspaces-title">Workspaces</h1>
          <p className="workspaces-subtitle muted">
            Remote staging workspaces across all projects on this server.
          </p>
        </div>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && state.data.workspaces.length === 0}
        emptyMessage="No workspaces yet. Open a project and create one from its Workspaces tab."
      >
        {state.kind === 'ok' && slice && (
          <>
            <ul className="card-list">
              {slice.items.map((w) => (
                <li key={`${w.namespace}/${w.repo}/${w.id}`}>
                  <Link
                    className="repo-summary-card"
                    to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}/workspaces/${encodeURIComponent(w.id)}`}
                  >
                    <span className="repo-summary-main">
                      <span className="card-title">{w.name}</span>
                      <span className="card-meta">
                        {w.namespace}/{w.repo}
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
              label="Workspaces pages"
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
