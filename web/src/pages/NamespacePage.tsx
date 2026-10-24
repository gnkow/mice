import { FolderGit2 as ActionFolderGit2, Settings as ActionSettings } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MetaPills } from '../components/MetaPills'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceAuthz, listAuthzNamespaces } from '../lib/authzApi'
import { getNamespace, listRepositories, listWorkspaces } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'
import type { ListRepositoryResponse, NamespaceResponse } from '../lib/oxen/types'
import { FavoriteStar } from '../components/FavoriteStar'
import { ListToolbar } from '../components/ListToolbar'
import { useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import type { RepositoryListView } from '../lib/oxen/types'

const NS_REPO_SORTS: SortFields<RepositoryListView> = { name: (r) => r.name, created: () => null }

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
  const [authz, summaries, detail, repos] = await Promise.all([
    fetchNamespaceAuthz(namespace, signal).catch(() => null),
    listAuthzNamespaces(signal).catch(() => null),
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
  const counts = await Promise.all(
    repos.repositories.map((r) =>
      listWorkspaces(namespace, r.name, signal)
        .then((w) => w.workspaces.length)
        .catch(() => 0),
    ),
  )
  return {
    authz,
    summary: summaries?.namespaces.find((n) => n.name === namespace) ?? null,
    workspaceCount: counts.reduce((a, b) => a + b, 0),
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
  const [filter, setFilter] = useState('')
  const sort = useListSort('namespace-repos', NS_REPO_SORTS)
  const favs = useFavorites()
  const repoList = state.kind === 'ok' ? state.data.repos.repositories : null
  const ordered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matching = (repoList ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle))
    return sort.apply(matching, (r) => favs.has('repo', `${r.namespace}/${r.name}`))
  }, [repoList, filter, sort.apply, favs])

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{namespace} <FavoriteStar type="namespace" id={namespace} /></h1>
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
          {state.kind === 'ok' && <NamespaceInfo namespace={namespace} data={state.data} />}
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}/settings`}
          >
            <ActionSettings size={14} aria-hidden="true" className="button-label-icon" />Settings
          </Link>
          <Link
            className="btn primary"
            to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}
          >
            <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />New repository
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
                    <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />New repository
                  </Link>
                </>
              }
            >
              <ListToolbar
                id="ns-repos"
                sort={sort}
                search={{ value: filter, onChange: setFilter, placeholder: 'Filter by name' }}
                meta={`${ordered.length} repositor${ordered.length === 1 ? 'y' : 'ies'}${filter.trim() ? ' matching' : ''}`}
              />
              <ul className="card-list">
                {ordered.map((repo) => (
                  <li key={`${repo.namespace}/${repo.name}`}>
                    <RepoSummaryCard
                      namespace={repo.namespace}
                      name={repo.name}
                      onDeleted={() => state.reload()}
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

function NamespaceInfo({
  namespace,
  data,
}: {
  namespace: string
  data: Awaited<ReturnType<typeof loadNamespacePage>>
}) {
  const repoCount = data.repos.repositories.length
  const { summary } = data
  return (
    <>
      <div className="ns-card-info">
        <p className="ns-card-meta muted small">
          {repoCount === 1 ? '1 repository' : `${repoCount} repositories`}
          {data.workspaceCount > 0 &&
            ` · ${data.workspaceCount} stage${data.workspaceCount === 1 ? '' : 's'}`}
        </p>
        <div className="ns-card-tags">
          {!data.detail && <span className="ns-tag ns-tag-muted">Empty</span>}
          {data.authz ? (
            <span className="ns-tag">base: {data.authz.basePermission}</span>
          ) : (
            data.detail && <span className="ns-tag ns-tag-warn">no access control</span>
          )}
          {summary && (
            <span className="ns-tag">
              {summary.memberCount} member{summary.memberCount === 1 ? '' : 's'}
            </span>
          )}
          {summary?.role && <span className="ns-tag ns-tag-accent">you: {summary.role}</span>}
        </div>
      </div>
      <MetaPills type="namespace" id={namespace} />
    </>
  )
}
