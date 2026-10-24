import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchAuthzMe } from '../lib/auth'

/**
 * When AuthZ enforce is on, zero-grant users are sent to /pending
 * (except instance admin / create_namespace, which the API already excludes).
 * Personal notification inbox/preferences remain available without resource grants.
 */
export function RequireAuthz() {
  const location = useLocation()
  // Re-check on every path change, but keep rendering the page while a previously
  // 'ok' result is being refreshed: showing the loading gate would unmount the routed
  // page (losing local state and swallowing in-flight clicks). A 'pending' user stays
  // gated until the new check completes.
  const [result, setResult] = useState<{ key: string; state: 'ok' | 'pending' }>()
  const state =
    result?.key === location.pathname ? result.state : result?.state === 'ok' ? 'ok' : 'loading'

  useEffect(() => {
    let cancelled = false
    fetchAuthzMe()
      .then((authz) => {
        if (cancelled) return
        if (!authz) {
          setResult({ key: location.pathname, state: 'ok' })
          return
        }
        setResult({ key: location.pathname, state: authz.enforce && authz.pending ? 'pending' : 'ok' })
      })
      .catch(() => {
        if (!cancelled) setResult({ key: location.pathname, state: 'ok' })
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (state === 'loading') {
    return (
      <div className="auth-boot" role="status" aria-label="Checking access">
        <p className="muted">Checking access…</p>
      </div>
    )
  }

  const personalNotifications = location.pathname === '/notifications' || location.pathname === '/profile' || location.pathname === '/profile/notifications'
  if (state === 'pending' && location.pathname !== '/pending' && !personalNotifications) {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
