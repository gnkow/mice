import { Link, useParams } from 'react-router-dom'
import { BookOpen, Copy, Lock } from 'lucide-react'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceAuthz } from '../lib/authzApi'
import { entityIdTitle } from '../lib/entityId'
import { getRepository } from '../lib/oxen/api'

export function RepoHeader() {
  const { namespace = '', repo = '' } = useParams()
  const nsAuthz = useAsync(
    (signal) => fetchNamespaceAuthz(namespace, signal).catch(() => null),
    [namespace],
  )
  const repoDetail = useAsync(
    (signal) => getRepository(namespace, repo, signal).catch(() => null),
    [namespace, repo],
  )
  const namespaceId = nsAuthz.kind === 'ok' ? nsAuthz.data?.id : null
  const repositoryId =
    repoDetail.kind === 'ok'
      ? repoDetail.data?.repository.repository_id ?? repoDetail.data?.repository_id ?? null
      : null

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(`${namespace}/${repo}`)
    } catch {
      /* ignore */
    }
  }

  return (
    <header className="repo-header">
      <div className="repo-breadcrumb" aria-label="Repository path">
        <BookOpen className="repo-book-icon" size={16} />
        <h1 className="repo-breadcrumb-title">
          <Link
            className="repo-header-owner"
            to={`/n/${encodeURIComponent(namespace)}`}
            title={namespaceId ? entityIdTitle('namespace', namespaceId) : undefined}
          >
            {namespace}
          </Link>
          <span className="repo-header-sep" aria-hidden>
            /
          </span>
          <Link
            className="repo-header-name-link"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`}
            title={repositoryId ? entityIdTitle('repository', repositoryId) : undefined}
          >
            {repo}
          </Link>
        </h1>
        <button
          type="button"
          className="icon-round repo-copy-btn"
          onClick={() => void copyPath()}
          title="Copy path"
          aria-label="Copy path"
        >
          <Copy size={14} />
        </button>
        <span
          className="visibility-icon-only visibility-local"
          title="This oxen-server has no visibility ACL"
          aria-label="local"
        >
          <Lock size={14} />
        </span>
      </div>
    </header>
  )
}
