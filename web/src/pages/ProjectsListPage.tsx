import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'

export function ProjectsListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return []
    if (!q) return state.data.projects
    return state.data.projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q),
    )
  }, [state, q])

  const slice = paginate(filtered, page, PAGE_SIZE)

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
          <h1>Projects</h1>
          <p className="lede">All repositories across namespaces.</p>
        </div>
        <Link className="btn primary" to="/repos/new">
          + New project
        </Link>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && filtered.length === 0}
        emptyMessage={
          q
            ? `No projects match “${params.get('q')}”.`
            : 'No projects yet. Create one to get started.'
        }
      >
        {state.kind === 'ok' && (
          <>
            {q && (
              <p className="muted small">
                Showing {slice.total} match{slice.total === 1 ? '' : 'es'} for “
                {params.get('q')}”.
              </p>
            )}
            <ul className="card-list">
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
              label="Projects pages"
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
