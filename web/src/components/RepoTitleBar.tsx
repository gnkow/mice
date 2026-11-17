import { Copy as ActionCopy } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { getRepository } from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { CloneBox } from './CloneBox'
import { EntityIdInline } from './EntityId'
import { FavoriteStar } from './FavoriteStar'
import { DataTypeIcon, SizeIcon } from './icons'
import { VisibilityPill } from './VisibilityPill'

export function RepoTitleBar() {
  const { namespace = '', repo = '' } = useParams()
  const repoId = `${namespace}/${repo}`
  const detail = useAsync(
    (signal) => getRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const repository = detail.kind === 'ok' ? detail.data.repository : null
  const repositoryId =
    repository?.repository_id ??
    (detail.kind === 'ok' ? detail.data.repository_id : null) ??
    null

  return (
    <div className="repo-title-bar">
      <div className="repo-title-row">
        <div className="repo-title-left">
          <div className="repo-title-identity">
            <h2 className="repo-title-name">{repo}</h2>
            {repositoryId ? <EntityIdInline kind="repository" id={repositoryId} /> : null}
          </div>
          <FavoriteStar type="repo" id={repoId} />
          <VisibilityPill />
        </div>
        <div className="repo-title-actions">
          <details className="clone-dropdown">
            <summary className="btn ghost"><ActionCopy size={14} aria-hidden="true" className="button-label-icon" />Clone</summary>
            <div className="clone-dropdown-panel">
              <CloneBox namespace={namespace} repo={repo} />
            </div>
          </details>
        </div>
      </div>
      {repository && (
        <div className="repo-stat-chips" aria-label="Repository stats">
          <span className="repo-stat-chip">
            <SizeIcon size={13} className="dtype-icon dtype-size" />
            {formatBytes(repository.size)}
          </span>
          {repository.data_types.map((dt) => (
            <span
              key={dt.data_type}
              className={`repo-stat-chip dtype-chip dtype-count-only dtype-${dt.data_type.toLowerCase()}`}
              title={`${dt.data_type}: ${dt.count}`}
              aria-label={`${dt.data_type}: ${dt.count}`}
            >
              <DataTypeIcon type={dt.data_type} size={13} />
              <span className="repo-stat-chip-num">{dt.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
