import { KeyRound, Terminal } from 'lucide-react'
import { useState } from 'react'
import { WebSessionsList } from './WebSessionsList'
import { AuthEventLog } from './AuthEventLog'

/**
 * CLI Access section - Device Flow only (no PATs)
 * 
 * Per authentication spec: "There are no PATs and no service principals"
 * CLI access is via `mice login` (RFC 8628 device flow) with short-lived credentials.
 */
export function ProfileCliAccessSection() {
  const [alsoPats, setAlsoPats] = useState(false)
  const [signedOut, setSignedOut] = useState(false)

  async function signOutEverywhere() {
    if (!window.confirm('Sign out of every browser session and CLI credential?')) return
    const res = await fetch('/auth/sessions/revoke-all', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePats: alsoPats }),
    })
    if (res.ok) setSignedOut(true)
  }

  return (
    <section id="cli-access" className="settings-section" aria-labelledby="cli-access-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="cli-access-heading">
            <KeyRound size={18} className="button-label-icon" aria-hidden="true" />
            CLI Access
          </h2>
          <p className="muted small">
            Use <code>mice login</code> for secure, short-lived CLI access. Your credential is stored in your OS keychain and automatically refreshed.
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

      <AuthEventLog />

      <h3>Sign out everywhere</h3>
      <p className="muted small">
        Revoke all your browser sessions and CLI credentials. Desktop sessions will be suspended.
      </p>
      <label>
        <input type="checkbox" checked={alsoPats} onChange={e => setAlsoPats(e.target.checked)} />
        {' '}Also revoke legacy CLI tokens (if any)
      </label>
      <div>
        <button className="btn ghost small" type="button" onClick={() => void signOutEverywhere()}>
          Sign out everywhere
        </button>
      </div>
      {signedOut && <p className="flash flash-success" role="status">Signed out everywhere. Desktop sessions suspended.</p>}
    </section>
  )
}
