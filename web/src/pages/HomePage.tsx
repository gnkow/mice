import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import { formatBytes } from '../lib/oxen/client'

export function HomePage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filteredProjects = useMemo(() => {
    if (state.kind !== 'ok') return []
    if (!q) return state.data.projects
    return state.data.projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q),
    )
  }, [state, q])

  const slice = paginate(filteredProjects, page, PAGE_SIZE)

  const storagePct =
    state.kind === 'ok' && state.data.storageBytes > 0
      ? Math.min(100, (state.data.storageBytes / (50 * 1024 ** 3)) * 100)
      : 0

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
          <h1>Home</h1>
        </div>
        {state.kind === 'ok' && (
          <div className="storage-meter" title="Reported storage from oxen-server">
            <span className="storage-meter-label">Storage</span>
            <strong className="small">
              {formatBytes(state.data.storageBytes)}
              {state.data.namespaces.length > 0 ? ' reported' : ''}
            </strong>
            <div className="storage-meter-bar" aria-hidden>
              <span style={{ width: `${storagePct || 2}%` }} />
            </div>
          </div>
        )}
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && state.data.namespaces.length === 0}
        emptyMessage={
          <div>
            <p className="muted">
              No projects yet. Create your first project to start versioning
              data.
            </p>
            <p>
              <Link className="btn primary" to="/repos/new">
                + New project
              </Link>
            </p>
          </div>
        }
      >
        {state.kind === 'ok' && (
          <>
            <div className="dash-stats" role="navigation" aria-label="Browse">
              <Link className="dash-stat dash-stat-link" to="/namespaces">
                <span className="dash-stat-value">
                  {state.data.namespaces.length}
                </span>
                <span className="dash-stat-label">Namespaces</span>
              </Link>
              <Link className="dash-stat dash-stat-link" to="/projects">
                <span className="dash-stat-value">
                  {state.data.projects.length}
                </span>
                <span className="dash-stat-label">Projects</span>
              </Link>
              <Link className="dash-stat dash-stat-link" to="/workspaces">
                <span className="dash-stat-value">
                  {state.data.workspaces.length}
                </span>
                <span className="dash-stat-label">Workspaces</span>
              </Link>
            </div>

            {q && (
              <p className="muted small">
                Filtering projects for “{params.get('q')}”.
              </p>
            )}

            <div className="projects-head">
              <h2>Projects</h2>
              <Link className="btn primary" to="/repos/new">
                + New project
              </Link>
            </div>

            {filteredProjects.length === 0 ? (
              <p className="muted small">No projects match this filter.</p>
            ) : (
              <>
                <ul className="card-list dash-repo-cards">
                  {slice.items.map((p) => (
                    <li key={`${p.namespace}/${p.name}`}>
                      <RepoSummaryCard namespace={p.namespace} name={p.name} />
                    </li>
                  ))}
                </ul>
                <Pagination
                  page={slice.page}
                  pageCount={slice.pageCount}
                  onPageChange={goPage}
                  label="Home projects pages"
                />
              </>
            )}
          </>
        )}
      </StateBlock>
    </main>
  )
}
