import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchAuthMe } from '../lib/auth'

/**
 * Blocks the Boxen app chrome until a BFF session exists.
 * Unauthenticated visitors are sent to /login (with return path).
 */
export function RequireAuth() {
  const location = useLocation()
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading')

  useEffect(() => {
    let cancelled = false
    fetchAuthMe()
      .then((me) => {
        if (!cancelled) setState(me.authenticated ? 'in' : 'out')
      })
      .catch(() => {
        if (!cancelled) setState('out')
      })
    return () => {
      cancelled = true
    }
  }, [location.key])

  if (state === 'loading') {
    return (
      <div className="auth-boot" role="status" aria-label="Checking sign-in">
        <p className="muted">Checking sign-in…</p>
      </div>
    )
  }

  if (state === 'out') {
    const next = `${location.pathname}${location.search}`
    const search =
      next && next !== '/'
        ? `?next=${encodeURIComponent(next)}`
        : ''
    return <Navigate to={`/login${search}`} replace />
  }

  return <Outlet />
}
