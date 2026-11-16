import {
  CircleAlert as IconStatusError,
  LogIn as ActionLogIn,
  TriangleAlert as IconStatusWarn,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoginBrand } from '../components/LoginBrand'
import { fetchAuthMe } from '../lib/auth'
import {
  applyAppearance,
  loadAppearance,
} from '../lib/appearance'
import { decideLoginNavigation } from '../lib/loginNavigation'
import { decideLoginStatus } from '../lib/loginStatus'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { returnPath: next, ssoHref } = decideLoginNavigation({ next: params.get('next') })
  const status = decideLoginStatus(params.get('status'))
  const statusRef = useRef<HTMLElement>(null)
  const [leaving, setLeaving] = useState(false)

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
    return () => {
      cancelled = true
    }
  }, [navigate, next])

  useEffect(() => {
    if (status) statusRef.current?.focus()
  }, [status])

  useEffect(() => {
    if (!leaving) return
    // Wait a paint so "Continuing…" is visible before /auth/login unloads the page.
    const id = window.setTimeout(() => {
      window.location.assign(ssoHref)
    }, 80)
    return () => window.clearTimeout(id)
  }, [leaving, ssoHref])

  return (
    <div className="login-shell">
      <main className="page narrow login-page" aria-labelledby="login-heading" aria-busy={leaving}>
        <LoginBrand />
        <h1 id="login-heading">Sign in</h1>
        <p className="lede" id="login-lede">
          Welcome. Use your organisation account to continue to Mice.
        </p>
        {status ? (
          <section
            ref={statusRef}
            className={`login-status flash ${status.tone === 'warn' ? 'flash-warn' : 'flash-error'}`}
            role="alert"
            aria-labelledby="login-status-title"
            aria-describedby="login-status-message login-status-hint"
            tabIndex={-1}
            data-testid="login-status"
            data-status={status.code}
          >
            {status.tone === 'warn' ? (
              <IconStatusWarn
                size={18}
                aria-hidden="true"
                className="login-status-icon"
              />
            ) : (
              <IconStatusError
                size={18}
                aria-hidden="true"
                className="login-status-icon"
              />
            )}
            <div className="login-status-copy">
              <h2 id="login-status-title">{status.title}</h2>
              <p id="login-status-message">{status.message}</p>
              <p id="login-status-hint" className="login-status-hint">
                {status.hint}
              </p>
            </div>
          </section>
        ) : null}
        <div className="btn-row">
          <a
            className="btn primary"
            href={ssoHref}
            aria-label="Sign in with SSO"
            aria-busy={leaving || undefined}
            aria-describedby={
              leaving
                ? 'login-sso-pending'
                : status
                  ? 'login-status-title login-lede'
                  : 'login-lede'
            }
            onClick={(e) => {
              e.preventDefault()
              setLeaving(true)
            }}
          >
            <ActionLogIn size={14} aria-hidden="true" className="button-label-icon" />
            {leaving ? 'Continuing…' : 'SSO'}
          </a>
        </div>
        {leaving ? (
          <p
            id="login-sso-pending"
            className="muted small"
            role="status"
            data-testid="login-sso-pending"
          >
            Continuing to sign-in…
          </p>
        ) : null}
      </main>
    </div>
  )
}
