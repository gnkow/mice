import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { devLogin, fetchAuthMe } from '../lib/auth'
import {
  applyAppearance,
  loadAppearance,
} from '../lib/appearance'

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/login')) return '/'
  return raw
}

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devAvailable, setDevAvailable] = useState(false)

  useEffect(() => {
    applyAppearance(loadAppearance())
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAuthMe()
      .then((me) => {
        if (!cancelled && me.authenticated) navigate(next, { replace: true })
      })
      .catch(() => {
        /* ignore */
      })
    fetch('/auth/dev-login-page', { method: 'GET', credentials: 'same-origin' })
      .then((r) => {
        if (!cancelled) setDevAvailable(r.ok)
      })
      .catch(() => {
        if (!cancelled) setDevAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [navigate, next])

  async function onDevLogin() {
    setBusy(true)
    setError(null)
    const ok = await devLogin()
    setBusy(false)
    if (!ok) {
      setError('Dev login failed (is AUTH_DEV_MODE enabled?)')
      return
    }
    navigate(next, { replace: true })
  }

  return (
    <div className="login-shell">
      <main className="page narrow login-page">
        <p className="login-brand">BOXEN</p>
        <h1>Sign in</h1>
        <p className="lede">
          Sign in with your organization IdP. The auth BFF establishes a session
          and proxies oxen-server on your behalf.
        </p>
        {error && <p className="flash flash-error">{error}</p>}
        <div className="btn-row">
          <a className="btn" href="/auth/login?prompt=login">
            Sign in with SSO
          </a>
          {devAvailable && (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={onDevLogin}
            >
              Dev login
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
