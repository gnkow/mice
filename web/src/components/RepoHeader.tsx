import { Link, useParams } from 'react-router-dom'
import { LockIcon } from './icons'

export function RepoHeader() {
  const { namespace = '', repo = '' } = useParams()

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
        <svg className="repo-book-icon" viewBox="0 0 16 16" aria-hidden>
          <path
            fill="currentColor"
            d="M1.5 2.5A1.5 1.5 0 0 1 3 1h9.5a.75.75 0 0 1 0 1.5H3a.5.5 0 0 0-.5.5v9.25a.5.5 0 0 0 .5.5h9.5a.75.75 0 0 1 0 1.5H3A1.5 1.5 0 0 1 1.5 12.5V2.5Zm4.25.25h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Zm0 3h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"
          />
        </svg>
        <h1 className="repo-breadcrumb-title">
          <Link
            className="repo-header-owner"
            to={`/n/${encodeURIComponent(namespace)}`}
          >
            {namespace}
          </Link>
          <span className="repo-header-sep" aria-hidden>
            /
          </span>
          <Link
            className="repo-header-name-link"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`}
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
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path
              fill="currentColor"
              d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5.09c.4 0 .78.16 1.06.44l2.91 2.91c.28.28.44.66.44 1.06V11.5A1.5 1.5 0 0 1 13.5 13H5.5A1.5 1.5 0 0 1 4 11.5v-9Zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5.91a.5.5 0 0 0-.15-.35L11.44 2.65a.5.5 0 0 0-.35-.15H5.5ZM2 4.75c0-.41.34-.75.75-.75H3.5v1.5H2.75a.25.25 0 0 0-.25.25v8c0 .14.11.25.25.25H11a.25.25 0 0 0 .25-.25V13.5h1.5v.25A1.75 1.75 0 0 1 11 15.5H2.75A1.75 1.75 0 0 1 1 13.75v-9Z"
            />
          </svg>
        </button>
        <span
          className="visibility-icon-only visibility-local"
          title="This oxen-server has no visibility ACL"
          aria-label="local"
        >
          <LockIcon size={14} />
        </span>
      </div>
    </header>
  )
}
