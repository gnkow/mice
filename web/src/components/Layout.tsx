import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
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
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const avatar = useMemo(
    () => initials(settings.authorName),
    [settings.authorName],
  )

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (searchRef.current) searchRef.current.open = false
    navigate(q ? `/projects?q=${encodeURIComponent(q)}` : '/projects')
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
                  <svg className="brand-mark" viewBox="0 0 16 16" aria-hidden>
                    <rect
                      x="1"
                      y="2"
                      width="14"
                      height="12"
                      rx="1.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span className="wordmark">Boxen</span>
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
                  Home
                </NavLink>
                <NavLink to="/namespaces" onClick={closeDrawer}>
                  Namespaces
                </NavLink>
                <NavLink to="/projects" onClick={closeDrawer}>
                  Projects
                </NavLink>
                <NavLink to="/workspaces" onClick={closeDrawer}>
                  Workspaces
                </NavLink>
                <NavLink to="/docs" onClick={closeDrawer}>
                  Docs
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
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                fill="currentColor"
                d="M2 4h12v1.5H2V4zm0 3.25h12v1.5H2v-1.5zm0 3.25h12V12H2v-1.5z"
              />
            </svg>
          </button>
          <NavLink to="/" className="brand-link" end>
            <span className="wordmark">BOXEN</span>
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
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M10.68 9.6a4.75 4.75 0 1 0-1.08 1.08l3.36 3.36.76-.76-3.04-3.68ZM6.75 10.5a3.75 3.75 0 1 1 0-7.5 3.75 3.75 0 0 1 0 7.5Z"
                />
              </svg>
            </summary>
            <form className="search-pop-panel" role="search" onSubmit={onSearch}>
              <input
                type="search"
                placeholder="Search projects…"
                aria-label="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </form>
          </details>
          <details className="menu-pop" ref={themeRef}>
            <summary className="icon-round" aria-label="Theme" title="Theme">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M8 1.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 1.5Zm0 10.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 12Zm6.5-4a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1 0-1.5h1a.75.75 0 0 1 .75.75ZM3.25 8a.75.75 0 0 1-.75.75h-1a.75.75 0 0 1 0-1.5h1A.75.75 0 0 1 3.25 8Zm8.66-4.16a.75.75 0 0 1 0 1.06l-.71.71a.75.75 0 1 1-1.06-1.06l.71-.71a.75.75 0 0 1 1.06 0ZM5.86 10.39a.75.75 0 0 1 0 1.06l-.71.71a.75.75 0 1 1-1.06-1.06l.71-.71a.75.75 0 0 1 1.06 0Zm6.39 1.06a.75.75 0 1 1-1.06 1.06l-.71-.71a.75.75 0 1 1 1.06-1.06l.71.71ZM5.15 3.9a.75.75 0 0 1 0 1.06l-.71.71A.75.75 0 1 1 3.38 4.6l.71-.71a.75.75 0 0 1 1.06 0ZM8 4.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z"
                />
              </svg>
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
              title={settings.authorName}
            >
              <span className="avatar-circle">{avatar}</span>
            </summary>
            <div className="profile-menu-panel">
              <p className="muted small">
                Signed as <strong>{settings.authorName}</strong>
              </p>
              <NavLink
                to="/settings"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false
                }}
              >
                Settings
              </NavLink>
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
            Cannot reach oxen-server.
            <NavLink to="/settings">Check Settings</NavLink>
          </div>
        )}
        <div className="app-body">
          <Outlet />
        </div>
        <footer className="site-footer">
          <NavLink to="/">Boxen</NavLink>
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
