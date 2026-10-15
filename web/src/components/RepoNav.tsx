import type { ReactNode } from 'react'
import { NavLink, useLocation, useParams } from 'react-router-dom'
import { lastBranch } from '../lib/lastBranch'

function TabIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="repo-nav-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      {children}
    </svg>
  )
}

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

  return (
    <nav className="repo-nav" aria-label="Repository">
      <NavLink
        to={`${base}/tree/${encodeURIComponent(filesBranch)}`}
        className={() => (onDataPath ? 'active' : undefined)}
        end={false}
      >
        <TabIcon>
          <path
            fill="currentColor"
            d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2h-11Zm0 1.5h11v1.25H2.5V3.5Zm0 2.75h11V12.5h-11V6.25Z"
          />
        </TabIcon>
        Data
      </NavLink>
      <NavLink
        to={`${base}/commits?branch=${encodeURIComponent(filesBranch)}`}
        className={() => (onHistory ? 'active' : undefined)}
      >
        <TabIcon>
          <path
            fill="currentColor"
            d="M1.5 8a6.5 6.5 0 1 1 2.02 4.64.75.75 0 0 1-.04-1.06.75.75 0 0 1 1.06-.04A5 5 0 1 0 3 8H4.5a.75.75 0 0 1 .53 1.28l-2 2a.75.75 0 0 1-1.06 0l-2-2A.75.75 0 0 1 .75 8H1.5Zm6.75-3a.75.75 0 0 1 .75.75v2.69l1.78 1.78a.75.75 0 1 1-1.06 1.06l-2-2A.75.75 0 0 1 7.5 8.75v-3A.75.75 0 0 1 8.25 5Z"
          />
        </TabIcon>
        History
      </NavLink>
      <NavLink to={`${base}/branches`}>
        <TabIcon>
          <path
            fill="currentColor"
            d="M5 3.25a1.75 1.75 0 1 1-1.5 2.8v1.4A2.75 2.75 0 0 0 6.25 10.2h1.9v-.95a1.75 1.75 0 1 1 1.5 0v.95h1.1A2.75 2.75 0 0 0 13.5 7.45V5.95a1.75 1.75 0 1 1 1.5 0v1.5A4.25 4.25 0 0 1 10.75 11.7H9.65v1.05a1.75 1.75 0 1 1-1.5 0V11.7H6.25A4.25 4.25 0 0 1 2 7.45V6.05a1.75 1.75 0 0 1 3-1.8Z"
          />
        </TabIcon>
        Branches
      </NavLink>
      <NavLink to={`${base}/merge`}>
        <TabIcon>
          <path
            fill="currentColor"
            d="M5 3.25a1.75 1.75 0 1 0-1.5 2.8v3.9a1.75 1.75 0 1 0 1.5 0V9.4A2.75 2.75 0 0 0 7.75 6.65h1.9v1.1a1.75 1.75 0 1 0 1.5 0V6.65h.1A2.75 2.75 0 0 0 14 3.9V3.05a1.75 1.75 0 1 0-1.5 0v.85a1.25 1.25 0 0 1-1.25 1.25h-.1V6.65h-1.9A4.25 4.25 0 0 1 5 10.9v-.95a1.75 1.75 0 0 0 0-3.5v-3.2Z"
          />
        </TabIcon>
        Merge
      </NavLink>
      <NavLink
        to={`${base}/workspaces`}
        className={() => (onWorkspaces ? 'active' : undefined)}
      >
        <TabIcon>
          <path
            fill="currentColor"
            d="M1.75 2A1.75 1.75 0 0 0 0 3.75v2.5c0 .97.78 1.75 1.75 1.75h5.5c.3 0 .55.24.55.55v3.7c0 .97.78 1.75 1.75 1.75h4.5A1.75 1.75 0 0 0 16 12.25v-2.5A1.75 1.75 0 0 0 14.25 8H8.75a.55.55 0 0 1-.55-.55V3.75C8.2 2.78 7.42 2 6.45 2h-4.7ZM1.5 3.75c0-.14.11-.25.25-.25h4.7c.14 0 .25.11.25.25v2.5a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25v-2.5Zm7.75 5.75h4.5c.14 0 .25.11.25.25v2.5a.25.25 0 0 1-.25.25h-4.5a.25.25 0 0 1-.25-.25v-2.5c0-.14.11-.25.25-.25Z"
          />
        </TabIcon>
        Workspaces
      </NavLink>
      <NavLink
        to={`${base}/settings`}
        className={() => (onSettings ? 'active' : undefined)}
      >
        <TabIcon>
          <path
            fill="currentColor"
            d="M6.5 1.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.6c.55.15 1.05.4 1.5.72l.45-.45a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1 0 1.06l-.45.45c.32.45.57.95.72 1.5h.6a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-.6a5.1 5.1 0 0 1-.72 1.5l.45.45a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 0 1-1.06 0l-.45-.45c-.45.32-.95.57-1.5.72v.6a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-.6a5.1 5.1 0 0 1-1.5-.72l-.45.45a.75.75 0 0 1-1.06 0L2.22 11.5a.75.75 0 0 1 0-1.06l.45-.45a5.1 5.1 0 0 1-.72-1.5h-.6A.75.75 0 0 1 .6 7.75v-1.5a.75.75 0 0 1 .75-.75h.6c.15-.55.4-1.05.72-1.5l-.45-.45a.75.75 0 0 1 0-1.06L3.28 1.43a.75.75 0 0 1 1.06 0l.45.45c.45-.32.95-.57 1.5-.72v-.6ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
          />
        </TabIcon>
        Settings
      </NavLink>
    </nav>
  )
}
