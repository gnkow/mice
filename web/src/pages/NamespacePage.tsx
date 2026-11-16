import { FolderGit2 as ActionFolderGit2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MetaPills } from '../components/MetaPills'
import { RepoSummaryCard } from '../components/RepoSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listRepositories, listWorkspaces } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'
import type { ListRepositoryResponse } from '../lib/oxen/types'
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

async function loadRepos(namespace: string, signal: AbortSignal) {
  const repos = await listRepositories(namespace, signal).catch((err: unknown) => {
    if (isNotFound(err)) {
      return {
        status: 'success',
        status_message: 'resource_created',
        repositories: [],
      } satisfies ListRepositoryResponse
    }
    throw err
  })
  const counts = await Promise.all(
    repos.repositories.map((r) =>
      listWorkspaces(namespace, r.name, signal)
        .then((w) => w.workspaces.length)
        .catch(() => 0),
    ),
  )
  return {
    repos,
    workspaceCount: counts.reduce((a, b) => a + b, 0),
  }
}

/** Repositories tab under `/n/:namespace`. */
export function NamespacePage() {
  const { namespace = '' } = useParams()
  const state = useAsync((signal) => loadRepos(namespace, signal), [namespace])
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
    <StateBlock
      loading={state.kind === 'loading'}
      error={state.kind === 'error' ? state.message : null}
      onRetry={() => state.reload()}
    >
      {state.kind === 'ok' && (
        <>
          <div className="projects-head">
            <h2>Repositories</h2>
            <p className="muted small">
              {state.data.repos.repositories.length === 1
                ? '1 repository'
                : `${state.data.repos.repositories.length} repositories`}
              {state.data.workspaceCount > 0 &&
                ` · ${state.data.workspaceCount} stage${state.data.workspaceCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <MetaPills type="namespace" id={namespace} />
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
                  <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />
                  New repository
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
  )
}
