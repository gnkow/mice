import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { fetchAuthzMe } from '../lib/auth'
import { shouldRedirectPendingUser } from '../lib/pendingAccessShell'

/**
 * When AuthZ enforce is on, users without a formal role are sent to /pending.
 * No escape routes (profile/notifications) — the no-access shell is the only UI (S32).
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

  if (state === 'pending' && shouldRedirectPendingUser(location.pathname, true)) {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
