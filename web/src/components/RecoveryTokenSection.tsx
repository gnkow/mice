import { Shield, AlertCircle, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import { useAsync } from '../hooks/useAsync'

type RecoveryTokenRequest = {
  requestId: string
  firstAdmin: { iss: string; sub: string; name: string }
  purpose: string
  requestedAt: number
  canApprove: boolean
}

type RecoveryToken = {
  tokenId: string
  issuedBy: [
    { iss: string; sub: string; name: string },
    { iss: string; sub: string; name: string }
  ]
  issuedAt: number
  expiresAt: number
  purpose: string
}

/**
 * TICKET 12: Two-Person Recovery Token Section
 * 
 * Admin UI for creating recovery tokens. Requires two different admins to approve.
 */
export function RecoveryTokenSection() {
  const [purpose, setPurpose] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [token, setToken] = useState<RecoveryToken | null>(null)

  const pending = useAsync(async (signal) => {
    const res = await fetch('/auth/admin/recovery-token/pending', { signal })
    if (!res.ok) throw new Error('Failed to load pending requests')
    const data = await res.json()
    return data.pending as RecoveryTokenRequest[]
  }, [requestId])

  async function requestToken() {
    if (!purpose.trim()) return
    
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/auth/admin/recovery-token/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose }),
      })
      
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to request token')
      }
      
      const data = await res.json()
      setRequestId(data.requestId)
      setPurpose('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request token')
    } finally {
      setLoading(false)
    }
  }

  async function approveToken(reqId: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/auth/admin/recovery-token/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: reqId }),
      })
      
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to approve token')
      }
      
      const data = await res.json()
      setToken(data.token)
      setRequestId(null) // Trigger refresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve token')
    } finally {
      setLoading(false)
    }
  }

  function copyToken() {
    if (!token) return
    navigator.clipboard.writeText(JSON.stringify(token, null, 2))
  }

  return (
    <div className="section">
      <h2>
        <Shield size={20} aria-hidden="true" />
        Two-Person Recovery Token
      </h2>
      <p className="muted">
        Emergency recovery tokens require approval from two different administrators.
        Tokens are valid for 1 hour and are single-use only. No shared credentials ever.
      </p>

      <div className="form">
        <label>
          Purpose
          <input
            type="text"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Emergency lockout recovery"
            disabled={loading}
          />
        </label>

        <button
          type="button"
          className="btn primary"
          onClick={() => void requestToken()}
          disabled={loading || !purpose.trim()}
        >
          <Shield size={14} aria-hidden="true" className="button-label-icon" />
          {loading ? 'Requesting...' : 'Request Recovery Token'}
        </button>

        {error && <p className="error">{error}</p>}
        {requestId && (
          <p className="success">
            <CheckCircle size={16} aria-hidden="true" /> 
            Request created. Awaiting second admin approval.
          </p>
        )}
      </div>

      {pending.kind === 'ok' && pending.data.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Pending Requests</h3>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Requested By</th>
                  <th>Purpose</th>
                  <th>Requested At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.data.map((req) => (
                  <tr key={req.requestId}>
                    <td>{req.firstAdmin.name}</td>
                    <td>{req.purpose}</td>
                    <td>{new Date(req.requestedAt).toLocaleString()}</td>
                    <td>
                      {req.canApprove ? (
                        <button
                          type="button"
                          className="btn primary small"
                          onClick={() => void approveToken(req.requestId)}
                          disabled={loading}
                        >
                          Approve
                        </button>
                      ) : (
                        <span className="muted small">Cannot approve own request</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {token && (
        <div className="card" style={{ marginTop: '2rem', background: '#fffbea' }}>
          <h3>
            <AlertCircle size={20} aria-hidden="true" />
            Recovery Token Created
          </h3>
          <p className="muted">
            Save this token securely. It expires in 1 hour and can only be used once.
          </p>
          
          <div style={{ marginTop: '1rem' }}>
            <p><strong>Token ID:</strong> <code>{token.tokenId}</code></p>
            <p><strong>Issued By:</strong></p>
            <ul style={{ marginLeft: '1.5rem' }}>
              <li>{token.issuedBy[0].name}</li>
              <li>{token.issuedBy[1].name}</li>
            </ul>
            <p><strong>Expires:</strong> {new Date(token.expiresAt).toLocaleString()}</p>
            <p><strong>Purpose:</strong> {token.purpose}</p>
          </div>

          <button
            type="button"
            className="btn"
            onClick={copyToken}
            style={{ marginTop: '1rem' }}
          >
            Copy Token JSON
          </button>
        </div>
      )}
    </div>
  )
}
