import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoginBrand } from './LoginBrand'
import { fetchAuthMe } from '../lib/auth'
import type { IdpAccessGate } from '../lib/idpAccessGate'
import { decideLoginNavigation } from '../lib/loginNavigation'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'in' }
  | { kind: 'out' }
  | { kind: 'gate'; gate: IdpAccessGate }

/**
 * Blocks the Mice app chrome until a BFF session exists.
 * Unauthenticated visitors are sent to /login (with return path).
 * Live IdP 503/403 denials show a route-level alert instead of a blank shell (ticket 19).
 */
export function RequireAuth() {
  const location = useLocation()
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const [retryBusy, setRetryBusy] = useState(false)
  const gateRef = useRef<HTMLElement>(null)

  function applyMe(me: Awaited<ReturnType<typeof fetchAuthMe>>) {
    if (me.authenticated) setState({ kind: 'in' })
    else if (me.gate) setState({ kind: 'gate', gate: me.gate })
    else setState({ kind: 'out' })
  }

  useEffect(() => {
    let cancelled = false
    fetchAuthMe()
      .then((me) => {
        if (cancelled) return
        applyMe(me)
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'out' })
      })
    return () => {
      cancelled = true
    }
  }, [location.key])

  useEffect(() => {
    if (state.kind === 'gate') gateRef.current?.focus()
  }, [state])

  async function onRetryGate() {
    setRetryBusy(true)
    setState({ kind: 'loading' })
    try {
      applyMe(await fetchAuthMe())
    } catch {
      setState({ kind: 'out' })
    } finally {
      setRetryBusy(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="auth-boot" role="status" aria-label="Checking sign-in">
        <p className="muted">Checking sign-in…</p>
      </div>
    )
  }

  if (state.kind === 'gate') {
    const { gate } = state
    return (
      <div className="login-shell">
        <main className="page narrow login-page" aria-labelledby="idp-gate-heading">
          <LoginBrand />
          <h1 id="idp-gate-heading">Sign-in check</h1>
          <section
            ref={gateRef}
            className={`flash ${gate.tone === 'warn' ? 'flash-warn' : 'flash-error'}`}
            role="alert"
            tabIndex={-1}
            data-testid="idp-access-gate"
            data-gate={gate.kind}
            data-status={gate.status}
            aria-labelledby="idp-gate-title"
          >
            <h2 id="idp-gate-title">{gate.title}</h2>
            <p>{gate.message}</p>
          </section>
          <div className="btn-row auth-panel-stack">
            <button
              type="button"
              className="btn primary"
              data-testid="idp-access-gate-retry"
              onClick={() => void onRetryGate()}
              disabled={retryBusy}
              aria-busy={retryBusy || undefined}
            >
              {retryBusy ? 'Checking…' : 'Try again'}
            </button>
            <Link className="btn ghost" to="/login">
              Back to sign in
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (state.kind === 'out') {
    const { redirectSearch } = decideLoginNavigation({
      location: `${location.pathname}${location.search}`,
    })
    return <Navigate to={`/login${redirectSearch}`} replace />
  }

  return <Outlet />
}
