import { LogIn as ActionLogIn } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchAuthMe } from '../lib/auth'
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
          <a
            className="btn"
            href={`/auth/login?prompt=login${
              next && next !== '/'
                ? `&next=${encodeURIComponent(next)}`
                : ''
            }`}
          >
            <ActionLogIn size={14} aria-hidden="true" className="button-label-icon" />Sign in with SSO
          </a>
        </div>
      </main>
    </div>
  )
}
