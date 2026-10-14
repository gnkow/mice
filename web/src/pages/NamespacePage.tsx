import { Link, useParams } from 'react-router-dom'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceAuthz } from '../lib/authzApi'
import { getNamespace, listRepositories } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'
import type { ListRepositoryResponse, NamespaceResponse } from '../lib/oxen/types'

function isNotFound(err: unknown): boolean {
  if (!(err instanceof OxenApiError)) return false
  if (err.status === 404) return true
  const msg = err.message.toLowerCase()
  return (
    msg.includes('resource_not_found') ||
    msg.includes('not found') ||
    msg.includes('does not exist')
  )
}

async function loadNamespacePage(namespace: string, signal: AbortSignal) {
  const [authz, detail, repos] = await Promise.all([
    fetchNamespaceAuthz(namespace, signal).catch(() => null),
    getNamespace(namespace, signal).catch((err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    }),
    listRepositories(namespace, signal).catch((err: unknown) => {
      if (isNotFound(err)) {
        return {
          status: 'success',
          status_message: 'resource_created',
          repositories: [],
        } satisfies ListRepositoryResponse
      }
      throw err
    }),
  ])

  // AuthZ-only namespace (no oxen object until first repo) is valid.
  if (!detail && !authz) {
    throw new Error('Namespace not found')
  }

  const oxenDetail: NamespaceResponse | null = detail
  return {
    authz,
    detail: oxenDetail,
    repos,
    storageGb: oxenDetail?.namespace.storage_usage_gb ?? 0,
  }
}

export function NamespacePage() {
  const { namespace = '' } = useParams()
  const state = useAsync(
    (signal) => loadNamespacePage(namespace, signal),
    [namespace],
  )

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{namespace}</h1>
          {state.kind === 'ok' && (
            <div className="storage-meter" style={{ marginTop: '0.75rem' }}>
              <span className="storage-meter-label">Storage</span>
              <strong className="small">
                {state.data.storageGb.toFixed(3)} GB
              </strong>
              <div className="storage-meter-bar" aria-hidden>
                <span
                  style={{
                    width: `${Math.min(100, Math.max(2, state.data.storageGb || 2))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}/settings`}
          >
            Settings
          </Link>
          <Link
            className="btn primary"
            to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}
          >
            + New repository
          </Link>
        </div>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' && (
          <>
            <div className="projects-head">
              <h2>Repositories</h2>
            </div>
            <StateBlock
              empty={state.data.repos.repositories.length === 0}
              emptyMessage={
                <>
                  <p className="muted">No repositories in this namespace.</p>
                  <p className="muted small">
                    Create the first repository to materialize it on oxen-server.
                  </p>
                  <Link
                    className="btn primary"
                    to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}
                  >
                    + New repository
                  </Link>
                </>
              }
            >
              <ul className="card-list">
                {state.data.repos.repositories.map((repo) => (
                  <li key={`${repo.namespace}/${repo.name}`}>
                    <RepoSummaryCard
                      namespace={repo.namespace}
                      name={repo.name}
                    />
                  </li>
                ))}
              </ul>
            </StateBlock>
          </>
        )}
      </StateBlock>
    </main>
  )
}
