import { KeyRound, LogOut } from 'lucide-react'
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
            Access
          </h2>
          <p className="muted small">
            Manage your browser sessions and CLI device credentials.
          </p>
        </div>
      </div>

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
