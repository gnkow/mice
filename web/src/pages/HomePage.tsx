import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listAuthzNamespaces } from '../lib/authzApi'
import { loadCatalog } from '../lib/catalog'
import { listJobs } from '../lib/jobs'
import { mergeNamespaces } from '../lib/mergeNamespaces'
import { formatBytes } from '../lib/oxen/client'

export function HomePage() {
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const authzNs = useAsync((signal) => listAuthzNamespaces(signal), [])
  const jobs = useAsync((signal) => listJobs({ limit: 100 }, signal), [])
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const mergedNamespaces = useMemo(() => {
    const oxen = catalog.kind === 'ok' ? catalog.data.namespaces : []
    const authz = authzNs.kind === 'ok' ? authzNs.data.namespaces : []
    return mergeNamespaces(oxen, authz)
  }, [catalog, authzNs])

  const repositories =
    catalog.kind === 'ok' ? catalog.data.repositories : []
  const workspaces = catalog.kind === 'ok' ? catalog.data.workspaces : []
  const storageBytes = catalog.kind === 'ok' ? catalog.data.storageBytes : 0
  const jobCount = jobs.kind === 'ok' ? jobs.data.jobs.length : 0

  const filteredRepos = useMemo(() => {
    if (!q) return repositories
    return repositories.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q),
    )
  }, [repositories, q])

  const slice = paginate(filteredRepos, page, PAGE_SIZE)

  const storagePct =
    storageBytes > 0
      ? Math.min(100, (storageBytes / (50 * 1024 ** 3)) * 100)
      : 0

  // Wait for AuthZ so empty (AuthZ-only) namespaces are included in the count.
  const loading =
    catalog.kind === 'loading' ||
    (authzNs.kind === 'loading' && catalog.kind !== 'error')
  const error = catalog.kind === 'error' ? catalog.message : null

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
        {!loading && !error && (
          <div className="storage-meter" title="Reported storage from oxen-server">
            <span className="storage-meter-label">Storage</span>
            <strong className="small">
              {formatBytes(storageBytes)}
              {mergedNamespaces.length > 0 ? ' reported' : ''}
            </strong>
            <div className="storage-meter-bar" aria-hidden>
              <span style={{ width: `${storagePct || 2}%` }} />
            </div>
          </div>
        )}
      </div>

      <StateBlock
        loading={loading}
        error={error}
        onRetry={() => {
          catalog.reload()
          authzNs.reload()
        }}
      >
        {!loading && !error && (
          <>
            <div className="dash-stats" role="navigation" aria-label="Browse">
              <Link className="dash-stat dash-stat-link" to="/namespaces">
                <span className="dash-stat-value">
                  {mergedNamespaces.length}
                </span>
                <span className="dash-stat-label">Namespaces</span>
              </Link>
              <Link className="dash-stat dash-stat-link" to="/repositories">
                <span className="dash-stat-value">{repositories.length}</span>
                <span className="dash-stat-label">Repositories</span>
              </Link>
              <Link className="dash-stat dash-stat-link" to="/workspaces">
                <span className="dash-stat-value">{workspaces.length}</span>
                <span className="dash-stat-label">Workspaces</span>
              </Link>
              <Link className="dash-stat dash-stat-link" to="/jobs">
                <span className="dash-stat-value">
                  {jobs.kind === 'loading' ? '…' : jobCount}
                </span>
                <span className="dash-stat-label">Jobs</span>
              </Link>
            </div>

            {q && (
              <p className="muted small">
                Filtering repositories for “{params.get('q')}”.
              </p>
            )}

            <div className="projects-head">
              <h2>Repositories</h2>
              <Link className="btn primary" to="/repos/new">
                + New repository
              </Link>
            </div>

            {filteredRepos.length === 0 ? (
              q ? (
                <p className="muted small">No repositories match this filter.</p>
              ) : mergedNamespaces.length > 0 ? (
                <p className="muted">
                  No repositories yet. Add one in{' '}
                  <Link to="/namespaces">a namespace</Link> to start versioning
                  data.
                </p>
              ) : (
                <p className="muted">
                  No repositories yet. Create your first repository to start
                  versioning data.
                </p>
              )
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
                  label="Home repositories pages"
                  total={slice.total}
                />
              </>
            )}
          </>
        )}
      </StateBlock>
    </main>
  )
}
