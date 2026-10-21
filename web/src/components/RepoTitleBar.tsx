import { Copy as ActionCopy } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { getRepository } from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { loadRepoSocial, saveRepoSocial } from '../lib/repoSocial'
import { CloneBox } from './CloneBox'
import { DataTypeIcon, SizeIcon, StarIcon } from './icons'
import { VisibilityPill } from './VisibilityPill'

export function RepoTitleBar() {
  const { namespace = '', repo = '' } = useParams()
  const repoId = `${namespace}/${repo}`
  const [seenRepo, setSeenRepo] = useState(repoId)
  const [social, setSocial] = useState(() => loadRepoSocial(namespace, repo))
  if (seenRepo !== repoId) {
    setSeenRepo(repoId)
    setSocial(loadRepoSocial(namespace, repo))
  }

  const detail = useAsync(
    (signal) => getRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const repository = detail.kind === 'ok' ? detail.data.repository : null

  function toggleStar() {
    const next = { ...loadRepoSocial(namespace, repo), star: !social.star }
    saveRepoSocial(namespace, repo, next)
    setSocial(next)
  }

  return (
    <div className="repo-title-bar">
      <div className="repo-title-row">
        <div className="repo-title-left">
          <h2 className="repo-title-name">{repo}</h2>
          <VisibilityPill />
        </div>
        <div className="repo-title-actions">
          <button
            type="button"
            className={`btn ghost star-btn ${social.star ? 'is-on' : ''}`}
            aria-pressed={social.star}
            onClick={toggleStar}
            title="Saved in this browser only"
          >
            <StarIcon filled={social.star} size={14} />
            {social.star ? 'Starred' : 'Star'}
          </button>
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
