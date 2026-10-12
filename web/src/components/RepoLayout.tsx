import { Navigate, Outlet, useParams } from 'react-router-dom'
import { lastBranch } from '../lib/lastBranch'
import { RepoAside } from './RepoAside'
import { RepoHeader } from './RepoHeader'
import { RepoNav } from './RepoNav'
import { RepoTitleBar } from './RepoTitleBar'

/** Nested layout for all `/n/:ns/r/:repo/*` routes. */
export function RepoLayout() {
  return (
    <div className="repo-shell">
      <div className="repo-shell-main">
        <div className="repo-shell-chrome">
          <RepoHeader />
          <RepoNav />
          <RepoTitleBar />
        </div>
        <Outlet />
      </div>
      <RepoAside />
    </div>
  )
}

/** `/n/:ns/r/:repo` → Files on last browsed branch (or main). */
export function RepoIndexRedirect() {
  const { namespace = '', repo = '' } = useParams()
  const branch = lastBranch(namespace, repo, 'main')
  return (
    <Navigate
      to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}`}
      replace
    />
  )
}
