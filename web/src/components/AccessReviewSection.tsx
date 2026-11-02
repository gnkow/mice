import { FileText, Download, Shield } from 'lucide-react'
import { useState } from 'react'

type AccessReviewReport = {
  reportId: string
  quarter: string
  generatedAt: number
  principals: Array<{
    principal: { iss: string; sub: string; name: string }
    roles: string[]
    grants: string[]
    lastLogin?: number
  }>
  reviewerSignature?: {
    hash: string
    principal: { iss: string; sub: string; name: string }
    signedAt: number
    meaning: string
    content: string
  }
}

/**
 * TICKET 12: Quarterly Access Review Section
 * 
 * Admin UI for generating and managing quarterly access review reports.
 */
export function AccessReviewSection() {
  const [quarter, setQuarter] = useState(() => {
    const now = new Date()
    const q = Math.floor(now.getMonth() / 3) + 1
    return `${now.getFullYear()}-Q${q}`
  })
  const [report, setReport] = useState<AccessReviewReport | null>(null)
  const [contentHash, setContentHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function showReport(data: { report: AccessReviewReport; contentHash?: string }) {
    setReport(data.report)
    setContentHash(data.contentHash ?? null)
  }

  async function openReport() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/auth/admin/access-review/${encodeURIComponent(quarter)}`, {
        credentials: 'same-origin',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to open report')
      showReport(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open report')
    } finally {
      setLoading(false)
    }
  }

  async function generateReport() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/auth/admin/access-review/generate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter }),
      })
      
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to generate report')
      }
      
      const data = await res.json()
      showReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  async function signReport() {
    if (!report || !contentHash) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/auth/admin/access-review/sign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter, expectedHash: contentHash }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (body.error === 'reauthentication_required') {
          throw new Error('Sign in again. A signature needs authentication from the last minute.')
        }
        throw new Error(body.error || 'Failed to sign report')
      }
      showReport(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign report')
    } finally {
      setLoading(false)
    }
  }

  function downloadReport() {
    if (!report) return
    
    const content = JSON.stringify(report, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `access-review-${report.quarter}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="section">
      <h2>
        <FileText size={20} aria-hidden="true" />
        Quarterly Access Review
      </h2>
      <p className="muted">
        Generate a quarterly report of every Principal, their roles, grants, and last login.
        Generating a quarter again opens the stored report. Open stored report reads that document without writing a new one.
      </p>

      <div className="form">
        <label>
          Quarter
          <input
            type="text"
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            placeholder="2026-Q4"
            disabled={loading}
          />
        </label>

        <button
          type="button"
          className="btn primary"
          onClick={() => void generateReport()}
          disabled={loading || !quarter}
        >
          <FileText size={14} aria-hidden="true" className="button-label-icon" />
          {loading ? 'Working...' : 'Generate Report'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void openReport()}
          disabled={loading || !quarter}
        >
          <Download size={14} aria-hidden="true" className="button-label-icon" />
          Open stored report
        </button>

        {error && <p className="error">{error}</p>}
      </div>

      {report && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Report: {report.quarter}</h3>
          <p className="muted">
            Generated {new Date(report.generatedAt).toLocaleString()}
          </p>
          
          <div style={{ marginTop: '1rem' }}>
            <p><strong>Principals:</strong> {report.principals.length}</p>
            {report.reviewerSignature && (
              <p className="muted">
                ✓ Signed by {report.reviewerSignature.principal.name} on{' '}
                {new Date(report.reviewerSignature.signedAt).toLocaleString()}
              </p>
            )}
            {!report.reviewerSignature && (
              <p className="warning">Awaiting an instance admin signature</p>
            )}
          </div>

          <div style={{ marginTop: '1rem' }}>
            {!report.reviewerSignature && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void signReport()}
                disabled={loading || !contentHash}
              >
                <Shield size={14} aria-hidden="true" className="button-label-icon" />
                Sign report
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={downloadReport}
            >
              <Download size={14} aria-hidden="true" className="button-label-icon" />
              Download JSON
            </button>
          </div>

          <details style={{ marginTop: '1rem' }}>
            <summary>View Principals ({report.principals.length})</summary>
            <div className="table-container" style={{ marginTop: '0.5rem' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Principal</th>
                    <th>Roles</th>
                    <th>Permissions</th>
                    <th>Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {report.principals.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <div>{p.principal.name}</div>
                        <div className="muted small">{p.principal.sub}</div>
                      </td>
                      <td>
                        {p.roles.length > 0 ? (
                          <div className="small">{p.roles.join(', ')}</div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {p.grants.length > 0 ? (
                          <div className="small">{p.grants.join(', ')}</div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {p.lastLogin ? (
                          <div className="small">
                            {new Date(p.lastLogin).toLocaleDateString()}
                          </div>
                        ) : (
                          <span className="muted">Never</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
