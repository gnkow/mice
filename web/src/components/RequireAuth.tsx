import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
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
  const gateRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchAuthMe()
      .then((me) => {
        if (cancelled) return
        if (me.authenticated) setState({ kind: 'in' })
        else if (me.gate) setState({ kind: 'gate', gate: me.gate })
        else setState({ kind: 'out' })
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
          <p className="login-brand">MICE</p>
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
          <p className="muted small">
            <Link to="/login">Back to sign in</Link>
          </p>
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
