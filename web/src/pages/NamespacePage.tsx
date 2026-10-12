import { Link, useParams } from 'react-router-dom'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { getNamespace, listRepositories } from '../lib/oxen/api'

export function NamespacePage() {
  const { namespace = '' } = useParams()
  const detail = useAsync(
    (signal) => getNamespace(namespace, signal),
    [namespace],
  )
  const repos = useAsync(
    (signal) => listRepositories(namespace, signal),
    [namespace],
  )

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{namespace}</h1>
          {detail.kind === 'ok' && (
            <div className="storage-meter" style={{ marginTop: '0.75rem' }}>
              <span className="storage-meter-label">Storage</span>
              <strong className="small">
                {detail.data.namespace.storage_usage_gb.toFixed(3)} GB
              </strong>
              <div className="storage-meter-bar" aria-hidden>
                <span
                  style={{
                    width: `${Math.min(100, Math.max(2, detail.data.namespace.storage_usage_gb))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <Link
          className="btn primary"
          to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}
        >
          + New project
        </Link>
      </div>

      <StateBlock
        loading={detail.kind === 'loading'}
        error={detail.kind === 'error' ? detail.message : null}
        onRetry={() => detail.reload()}
      >
        {null}
      </StateBlock>

      <div className="projects-head">
        <h2>Projects</h2>
      </div>
      <StateBlock
        loading={repos.kind === 'loading'}
        error={repos.kind === 'error' ? repos.message : null}
        onRetry={() => repos.reload()}
        empty={
          repos.kind === 'ok' && repos.data.repositories.length === 0
        }
        emptyMessage="No projects in this namespace."
      >
        {repos.kind === 'ok' && (
          <ul className="card-list">
            {repos.data.repositories.map((repo) => (
              <li key={`${repo.namespace}/${repo.name}`}>
                <RepoSummaryCard
                  namespace={repo.namespace}
                  name={repo.name}
                />
              </li>
            ))}
          </ul>
        )}
      </StateBlock>
    </main>
  )
}
