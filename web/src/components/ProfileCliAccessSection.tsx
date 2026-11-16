import { KeyRound, LogOut } from 'lucide-react'
import { useState } from 'react'
import { WebSessionsList } from './WebSessionsList'
import { DeviceSessionsList } from './DeviceSessionsList'
import { AuthEventLog } from './AuthEventLog'

/**
 * Access Management — browser sessions and short-lived CLI device credentials.
 * Device approval issues rotating CLI credentials; this surface does not mint PATs.
 */
export function ProfileCliAccessSection() {
  const [signedOut, setSignedOut] = useState(false)
  const [revoking, setRevoking] = useState(false)

  async function signOutEverywhere() {
    if (
      !window.confirm(
        'Sign out of every browser session and CLI device credential? You will need to log in again.',
      )
    ) {
      return
    }

    setRevoking(true)
    try {
      const res = await fetch('/auth/sessions/revoke-all', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setSignedOut(true)
        setTimeout(() => {
          window.location.href = '/login'
        }, 2000)
      }
    } finally {
      setRevoking(false)
    }
  }

  return (
    <section
      id="access-management"
      className="settings-section"
      data-testid="profile-cli-access"
      aria-labelledby="access-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-heading">
            <KeyRound size={18} className="button-label-icon" aria-hidden="true" />
            Access
          </h2>
          <p className="muted small">
            Manage browser sessions, short-lived CLI credentials from <code>mice login</code>,
            and recent security activity. Personal access tokens are not minted here.
          </p>
        </div>
      </div>

      <WebSessionsList />

      <DeviceSessionsList />

      <AuthEventLog />

      <div id="profile-sign-out-everywhere" className="ns-settings-subsection">
        <div className="ns-settings-section-head">
          <div>
            <h3>
              <LogOut size={16} className="button-label-icon" aria-hidden="true" />
              Sign Out All
            </h3>
            <p className="muted small">
              Revoke all browser sessions and CLI credentials. You will be logged out
              immediately.
            </p>
          </div>
        </div>
        <button
          className="btn danger"
          type="button"
          onClick={() => void signOutEverywhere()}
          disabled={revoking}
        >
          {revoking ? 'Signing out…' : 'Sign Out All'}
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
