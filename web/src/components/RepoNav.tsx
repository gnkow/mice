import { NavLink, useLocation, useParams } from 'react-router-dom'
import {
  Table,
  History,
  GitBranch,
  GitMerge,
  Layers,
  Terminal,
  Monitor,
  Settings,
} from 'lucide-react'
import { lastBranch } from '../lib/lastBranch'

export function RepoNav() {
  const { namespace = '', repo = '' } = useParams()
  const location = useLocation()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const filesBranch = lastBranch(namespace, repo, 'main')

  const onDataPath =
    location.pathname.includes('/tree/') ||
    location.pathname.includes('/blob/') ||
    location.pathname.includes('/df/')

  const onHistory =
    location.pathname === `${base}/commits` ||
    location.pathname.startsWith(`${base}/commits/`)

  const onSettings = location.pathname === `${base}/settings`
  const onWorkspaces =
    location.pathname === `${base}/workspaces` ||
    location.pathname.startsWith(`${base}/workspaces/`)
  const onJobs =
    location.pathname === `${base}/jobs` ||
    location.pathname.startsWith(`${base}/jobs/`)
  const onSessions =
    location.pathname === `${base}/sessions` ||
    location.pathname.startsWith(`${base}/sessions/`)

  return (
    <nav className="repo-nav" aria-label="Repository">
      <NavLink
        to={`${base}/tree/${encodeURIComponent(filesBranch)}`}
        className={() => (onDataPath ? 'active' : undefined)}
        end={false}
      >
        <Table className="repo-nav-icon" size={14} />
        Data
      </NavLink>
      <NavLink
        to={`${base}/commits?branch=${encodeURIComponent(filesBranch)}`}
        className={() => (onHistory ? 'active' : undefined)}
      >
        <History className="repo-nav-icon" size={14} />
        History
      </NavLink>
      <NavLink to={`${base}/branches`}>
        <GitBranch className="repo-nav-icon" size={14} />
        Branches
      </NavLink>
      <NavLink to={`${base}/merge`}>
        <GitMerge className="repo-nav-icon" size={14} />
        Merge
      </NavLink>
      <NavLink
        to={`${base}/workspaces`}
        className={() => (onWorkspaces ? 'active' : undefined)}
      >
        <Layers className="repo-nav-icon" size={14} />
        Workspaces
      </NavLink>
      <NavLink
        to={`${base}/jobs`}
        className={() => (onJobs ? 'active' : undefined)}
      >
        <Terminal className="repo-nav-icon" size={14} />
        Jobs
      </NavLink>
      <NavLink
        to={`${base}/sessions`}
        className={() => (onSessions ? 'active' : undefined)}
      >
        <Monitor className="repo-nav-icon" size={14} />
        Sessions
      </NavLink>
      <NavLink
        to={`${base}/settings`}
        className={() => (onSettings ? 'active' : undefined)}
      >
        <Settings className="repo-nav-icon" size={14} />
        Settings
      </NavLink>
    </nav>
  )
}
