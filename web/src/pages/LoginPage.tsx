import { LogIn as ActionLogIn } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

  return (
    <div className="login-shell">
      <main className="page narrow login-page" aria-labelledby="login-heading">
        <p className="login-brand">MICE</p>
        <h1 id="login-heading">Sign in</h1>
        <p className="lede" id="login-lede">
          Sign in with your organization IdP. The auth BFF establishes a session
          and proxies oxen-server on your behalf.
        </p>
        {status ? (
          <section
            ref={statusRef}
            className={`flash ${status.tone === 'warn' ? 'flash-warn' : 'flash-error'}`}
            role="alert"
            aria-labelledby="login-status-title"
            tabIndex={-1}
            data-testid="login-status"
            data-status={status.code}
          >
            <h2 id="login-status-title">{status.title}</h2>
            <p>{status.message}</p>
          </section>
        ) : null}
        <div className="btn-row">
          <a
            className="btn primary"
            href={ssoHref}
            aria-describedby={status ? 'login-status-title login-lede' : 'login-lede'}
          >
            <ActionLogIn size={14} aria-hidden="true" className="button-label-icon" />
            Sign in with SSO
          </a>
        </div>
      </main>
    </div>
  )
}
