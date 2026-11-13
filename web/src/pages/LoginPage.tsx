import { LogIn as ActionLogIn } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchAuthMe } from '../lib/auth'
import {
  applyAppearance,
  loadAppearance,
} from '../lib/appearance'
import { decideLoginNavigation } from '../lib/loginNavigation'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { returnPath: next, ssoHref } = decideLoginNavigation({ next: params.get('next') })

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

  return (
    <div className="login-shell">
      <main className="page narrow login-page">
        <p className="login-brand">MICE</p>
        <h1>Sign in</h1>
        <p className="lede">
          Sign in with your organization IdP. The auth BFF establishes a session
          and proxies oxen-server on your behalf.
        </p>
        <div className="btn-row">
          <a className="btn primary" href={ssoHref}>
            <ActionLogIn size={14} aria-hidden="true" className="button-label-icon" />
            Sign in with SSO
          </a>
        </div>
      </main>
    </div>
  )
}
