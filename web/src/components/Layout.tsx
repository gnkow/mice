import { LogOut as ActionLogOut } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { BookOpen, Box, ClipboardList, FolderGit2, Home, Layers, Menu, Monitor, Network, Search, Sun, Tags, Terminal } from 'lucide-react'
import { fetchAuthMe, logout, type AuthUser } from '../lib/auth'
import { fetchServerVersion } from '../lib/oxen/api'
import { loadSettings, subscribeSettings } from '../lib/oxen/settings'
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  subscribeAppearance,
  type Appearance,
  type ColorMode,
  type DiffPalette,
} from '../lib/appearance'
import { ConfirmProvider } from './ConfirmProvider'
import { initials } from '../lib/initials'

function useCloseDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = ref.current
      if (!el?.open) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        el.open = false
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [ref])
}

export function Layout() {
  const navigate = useNavigate()
  const [version, setVersion] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [settings, setSettings] = useState(() => loadSettings())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance())
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const themeRef = useRef<HTMLDetailsElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const searchRef = useRef<HTMLDetailsElement>(null)
  useCloseDetails(themeRef)
  useCloseDetails(menuRef)
  useCloseDetails(searchRef)

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  useEffect(() => {
    return subscribeAppearance(() => setAppearance(loadAppearance()))
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAuthMe()
      .then((me) => {
        if (cancelled) return
        setUser(me.authenticated ? me.user : null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const probe = () => {
      const controller = new AbortController()
      fetchServerVersion(controller.signal)
        .then((data) => {
          if (cancelled) return
          setVersion(data.oxen_version)
          setConnected(true)
        })
        .catch(() => {
          if (cancelled) return
          setVersion(null)
          setConnected(false)
        })
      return controller
    }

    let controller = probe()
    const unsub = subscribeSettings(() => {
      setSettings(loadSettings())
      controller.abort()
      controller = probe()
    })
    return () => {
      cancelled = true
      controller.abort()
      unsub()
    }
  }, [user])

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const displayName = user?.name ?? 'Sign in'
  const avatar = useMemo(() => initials(displayName), [displayName])

  async function onLogout() {
    if (menuRef.current) menuRef.current.open = false
    const result = await logout()
    setUser(null)
    setConnected(false)
    setVersion(null)
    // Full navigation clears IdP SSO so the next "Sign in with SSO" shows credentials.
    if (result.idpLogoutUrl) {
      window.location.assign(result.idpLogoutUrl)
      return
    }
    window.location.assign('/login')
  }

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (searchRef.current) searchRef.current.open = false
    navigate(
      q ? `/repositories?q=${encodeURIComponent(q)}` : '/repositories',
    )
  }

  function setColorMode(colorMode: ColorMode) {
    const next = { ...loadAppearance(), colorMode }
    saveAppearance(next)
    setAppearance(next)
  }

  function setDiffPalette(diffPalette: DiffPalette) {
    const next = { ...loadAppearance(), diffPalette }
    saveAppearance(next)
    setAppearance(next)
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  return (
    <ConfirmProvider>
      <div className="app">
        {drawerOpen && (
          <>
            <button
              type="button"
              className="drawer-backdrop"
              aria-label="Close navigation"
              onClick={closeDrawer}
            />
            <aside className="drawer" aria-label="Main navigation">
              <div className="drawer-head">
                <NavLink to="/" className="brand-link" end onClick={closeDrawer}>
                  <Box className="brand-mark" size={20} strokeWidth={1.5} />
                  <span className="wordmark">Mice</span>
                </NavLink>
                <button
                  type="button"
                  className="icon-round"
                  aria-label="Close menu"
                  onClick={closeDrawer}
                >
                  ×
                </button>
              </div>
              <nav className="drawer-nav">
                <NavLink to="/" end onClick={closeDrawer}>
                  <Home size={18} aria-hidden="true" />Home
                </NavLink>
                <NavLink to="/namespaces" onClick={closeDrawer}>
                  <Network size={18} aria-hidden="true" />Namespaces
                </NavLink>
                <NavLink to="/repositories" onClick={closeDrawer}>
                  <FolderGit2 size={18} aria-hidden="true" />Repositories
                </NavLink>
                <NavLink to="/workspaces" onClick={closeDrawer}>
                  <Layers size={18} aria-hidden="true" />Workspaces
                </NavLink>
                <NavLink to="/jobs" onClick={closeDrawer}>
                  <Terminal size={18} aria-hidden="true" />Jobs
                </NavLink>
                <NavLink to="/sessions" onClick={closeDrawer}>
                  <Monitor size={18} aria-hidden="true" />Sessions
                </NavLink>
                <NavLink to="/meta" end onClick={closeDrawer}>
                  <Tags size={18} aria-hidden="true" />Metadata
                </NavLink>
                <NavLink to="/audit" onClick={closeDrawer}>
                  <ClipboardList size={18} aria-hidden="true" />Audit
                </NavLink>
                <NavLink to="/docs" onClick={closeDrawer}>
                  <BookOpen size={18} aria-hidden="true" />Docs
                </NavLink>
              </nav>
            </aside>
          </>
        )}

        <header className="topbar">
          <button
            type="button"
            className="drawer-toggle"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={16} />
          </button>
          <NavLink to="/" className="brand-link" end>
            <span className="wordmark">MICE</span>
          </NavLink>
          <div className="topbar-spacer" />
          {connected === false && (
            <div
              className="conn bad"
              title={settings.apiBase || 'same-origin /api'}
            >
              offline
            </div>
          )}
          <details className="search-pop" ref={searchRef}>
            <summary className="icon-round" aria-label="Search" title="Search">
              <Search size={16} />
            </summary>
            <form className="search-pop-panel" role="search" onSubmit={onSearch}>
              <input
                type="search"
                placeholder="Search repositories…"
                aria-label="Search repositories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </form>
          </details>
          <details className="menu-pop" ref={themeRef}>
            <summary className="icon-round" aria-label="Theme" title="Theme">
              <Sun size={16} />
            </summary>
            <div className="menu-pop-panel">
              <fieldset className="appearance-fieldset">
                <legend>Theme</legend>
                {(
                  [
                    ['light', 'Light'],
                    ['dark', 'Dark'],
                    ['system', 'System'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="color-mode"
                      checked={appearance.colorMode === value}
                      onChange={() => setColorMode(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <fieldset className="appearance-fieldset">
                <legend>Diff colors</legend>
                <label>
                  <input
                    type="radio"
                    name="diff-palette"
                    checked={appearance.diffPalette === 'default'}
                    onChange={() => setDiffPalette('default')}
                  />
                  Default
                </label>
                <label>
                  <input
                    type="radio"
                    name="diff-palette"
                    checked={appearance.diffPalette === 'colorblind'}
                    onChange={() => setDiffPalette('colorblind')}
                  />
                  Colorblind
                </label>
              </fieldset>
            </div>
          </details>
          <details className="profile-menu" ref={menuRef}>
            <summary
              className="avatar-btn"
              aria-label="Account menu"
              title={displayName}
            >
              <span className="avatar-circle">{avatar}</span>
            </summary>
            <div className="profile-menu-panel">
              {user ? (
                <p className="muted small">
                  Signed as <strong>{user.name}</strong>
                  <br />
                  <span>{user.email}</span>
                </p>
              ) : (
                <p className="muted small">Not signed in</p>
              )}
              {!user && (
                <NavLink
                  to="/login"
                  onClick={() => {
                    if (menuRef.current) menuRef.current.open = false
                  }}
                >
                  Sign in
                </NavLink>
              )}
              <NavLink
                to="/settings"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false
                }}
              >
                Settings
              </NavLink>
              {user && (
                <button type="button" className="linkish" onClick={onLogout}>
                  <ActionLogOut size={14} aria-hidden="true" className="button-label-icon" />Sign out
                </button>
              )}
              <div className="profile-menu-footer">
                <p className="muted small">
                  {connected === true
                    ? `Server v${version}`
                    : connected === false
                      ? 'Offline'
                      : 'Checking connection…'}
                </p>
              </div>
            </div>
          </details>
        </header>
        {connected === false && (
          <div className="offline-banner flash flash-error" role="alert">
            {user
              ? 'Cannot reach oxen-server via the auth BFF.'
              : 'Sign in required to reach oxen-server.'}
            {user ? (
              <NavLink to="/settings">Check Settings</NavLink>
            ) : (
              <NavLink to="/login">Sign in</NavLink>
            )}
          </div>
        )}
        <div className="app-body">
          <Outlet />
        </div>
        <footer className="site-footer">
          <NavLink to="/">Mice</NavLink>
          <a href="https://docs.oxen.ai/" rel="noreferrer" target="_blank">
            Oxen docs
          </a>
          <a
            href="https://docs.oxen.ai/getting-started/oxen-server"
            rel="noreferrer"
            target="_blank"
          >
            oxen-server
          </a>
          <span className="muted small">Self-hosted UI for Oxen</span>
        </footer>
      </div>
    </ConfirmProvider>
  )
}
