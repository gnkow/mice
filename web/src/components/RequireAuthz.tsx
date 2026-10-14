import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchAuthzMe } from '../lib/auth'

/**
 * When AuthZ enforce is on, zero-grant users are sent to /pending
 * (except instance admin / create_namespace, which the API already excludes).
 */
export function RequireAuthz() {
  const location = useLocation()
  const [state, setState] = useState<'loading' | 'ok' | 'pending'>('loading')

  useEffect(() => {
    let cancelled = false
    fetchAuthzMe()
      .then((authz) => {
        if (cancelled) return
        if (!authz) {
          setState('ok')
          return
        }
        setState(authz.enforce && authz.pending ? 'pending' : 'ok')
      })
      .catch(() => {
        if (!cancelled) setState('ok')
      })
    return () => {
      cancelled = true
    }
  }, [location.key])

  if (state === 'loading') {
    return (
      <div className="auth-boot" role="status" aria-label="Checking access">
        <p className="muted">Checking access…</p>
      </div>
    )
  }

  if (state === 'pending' && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
