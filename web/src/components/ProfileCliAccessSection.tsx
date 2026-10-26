import { KeyRound, LogOut, Terminal } from 'lucide-react'
import { useState } from 'react'
import { WebSessionsList } from './WebSessionsList'
import { DeviceSessionsList } from './DeviceSessionsList'
import { AuthEventLog } from './AuthEventLog'

/**
 * Access Management section - Web and Device Sessions
 * 
 * Per authentication spec: "There are no PATs and no service principals"
 * CLI access is via `mice login` (RFC 8628 device flow) with short-lived credentials.
 */
export function ProfileCliAccessSection() {
  const [signedOut, setSignedOut] = useState(false)
  const [revoking, setRevoking] = useState(false)

  async function signOutEverywhere() {
    if (!window.confirm('Sign out of every browser session and CLI credential? You will need to log in again.')) return
    
    setRevoking(true)
    try {
      const res = await fetch('/auth/sessions/revoke-all', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includePats: true }),
      })
      if (res.ok) {
        setSignedOut(true)
        // Redirect to login after a delay
        setTimeout(() => {
          window.location.href = '/login'
        }, 2000)
      }
    } finally {
      setRevoking(false)
    }
  }

  return (
    <section id="access-management" className="settings-section" aria-labelledby="access-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-heading">
            <KeyRound size={18} className="button-label-icon" aria-hidden="true" />
            Access Management
          </h2>
          <p className="muted small">
            Manage your browser sessions and CLI device credentials.
          </p>
        </div>
      </div>

      <div className="flash flash-info" role="status">
        <h3>
          <Terminal size={16} className="button-label-icon" aria-hidden="true" />
          Using the CLI
        </h3>
        <pre className="settings-code mono">{`# Login with device flow (8-hour access token)
mice login

# Clone and work with repositories
mice clone http://localhost:8080/<namespace>/<repo>
cd <repo>
mice push

# Logout (revokes CLI credential)
mice logout`}</pre>
      </div>

      <details>
        <summary>How CLI authentication works</summary>
        <div className="muted small">
          <p>
            <strong>Device Flow (RFC 8628):</strong> When you run <code>mice login</code>, you'll get a code to enter in your browser. After approving, the CLI receives a short-lived access token (8 hours) and a refresh token.
          </p>
          <p>
            <strong>Security features:</strong>
          </p>
          <ul>
            <li>Credentials stored securely in your OS keychain</li>
            <li>Automatic refresh for up to 30 days</li>
            <li>IdP status checked on each refresh</li>
            <li>Single Principal per OS user (shared credentials forbidden)</li>
            <li>No long-lived tokens</li>
          </ul>
          <p>
            <strong>CI/Automation:</strong> Not supported. Jobs use BFF-internal tokens attributed to the submitting user.
          </p>
        </div>
      </details>

      <WebSessionsList />

      <DeviceSessionsList />

      <AuthEventLog />

      <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
        <h3>
          <LogOut size={16} className="button-label-icon" aria-hidden="true" />
          Sign Out Everywhere
        </h3>
        <p className="muted small">
          Revoke all your browser sessions and CLI device credentials. You will be logged out immediately.
        </p>
        <button 
          className="btn danger" 
          type="button" 
          onClick={() => void signOutEverywhere()}
          disabled={revoking}
        >
          {revoking ? 'Signing out...' : 'Sign out everywhere'}
        </button>
        {signedOut && (
          <p className="flash flash-success" role="status">
            Signed out everywhere. Redirecting to login...
          </p>
        )}
      </div>
    </section>
  )
}
