import { AlertTriangle, FileText, Download, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatPrivilegedActionError } from '../lib/privilegedActionError'
import { decideSignatureNameDisplay } from '../lib/signatureName'
import {
  classifySigningChallenge,
  type SigningChallenge,
} from '../lib/signingChallenge'
import { continueToSigningReauth, pageResumePath } from '../lib/signingResume'
import { Pagination, paginate } from './Pagination'
import { SigningChallengeInterstitial } from './SigningChallengeInterstitial'
import { UserRef } from './UserRef'

/** Compact page size so the Principals table paginates in typical review sizes. */
const PRINCIPAL_PAGE_SIZE = 5

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
  const [overdue, setOverdue] = useState<Array<{ quarter: string; reportId: string }>>([])
  const [loading, setLoading] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<SigningChallenge | null>(null)
  const [currentName, setCurrentName] = useState<string | null>(null)
  const [principalPage, setPrincipalPage] = useState(1)

  async function loadOverdue() {
    const res = await fetch('/auth/admin/access-review/overdue', { credentials: 'same-origin' })
    if (!res.ok) return
    const body = await res.json() as { overdue?: Array<{ quarter: string; reportId: string }> }
    setOverdue(body.overdue ?? [])
  }

  useEffect(() => { void loadOverdue() }, [])

  function showReport(data: { report: AccessReviewReport; contentHash?: string }) {
    setReport(data.report)
    setContentHash(data.contentHash ?? null)
    setPrincipalPage(1)
    const signer = data.report.reviewerSignature?.principal
    if (!signer) {
      setCurrentName(null)
      return
    }
    const params = new URLSearchParams({ iss: signer.iss, sub: signer.sub })
    void fetch(`/auth/admin/principals/names?${params}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { currentName?: string | null } | null) => setCurrentName(body?.currentName ?? null))
      .catch(() => setCurrentName(null))
  }

  async function openReport(forQuarter = quarter) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/auth/admin/access-review/${encodeURIComponent(forQuarter)}`, {
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

  function openOverdueReport(row: { quarter: string; reportId: string }) {
    setQuarter(row.quarter)
    void openReport(row.quarter)
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
    setSigning(true)
    setError(null)
    setChallenge(null)
    try {
      const res = await fetch('/auth/admin/access-review/sign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter, expectedHash: contentHash }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const next = classifySigningChallenge(res.status, body, {
          resumePath: pageResumePath(),
        })
        if (next) {
          setChallenge(next)
          return
        }
        const apiError =
          typeof body.error === 'string' ? body.error : 'Failed to sign report'
        // Privileged path: deepen directory / group recheck failures (ticket 37).
        throw new Error(formatPrivilegedActionError(apiError, res.status).message)
      }
      showReport(body as { report: AccessReviewReport; contentHash?: string })
      await loadOverdue()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign report')
    } finally {
      setSigning(false)
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
    <section id="access-review" className="settings-section" aria-labelledby="access-review-heading">
      {challenge ? (
        <SigningChallengeInterstitial
          challenge={challenge}
          onDismiss={() => setChallenge(null)}
          onContinue={() => {
            if (challenge.continueUrl) continueToSigningReauth(challenge.continueUrl)
          }}
        />
      ) : null}
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-review-heading">
            <FileText size={18} className="button-label-icon" aria-hidden="true" />
            Quarterly Access Review
          </h2>
          <p className="muted small">
            Generate a quarterly report of every Principal, their roles, grants, and last login.
            Generating a quarter again opens the stored report. Open stored report reads that document without writing a new one.
          </p>
        </div>
      </div>

      {overdue.length > 0 && (
        <div
          className="flash flash-warn"
          role="alert"
          aria-labelledby="access-review-overdue-title"
          data-testid="access-review-overdue-alert"
        >
          <p id="access-review-overdue-title">
            <AlertTriangle size={16} aria-hidden="true" className="button-label-icon" />
            Unsigned for 14+ days
          </p>
          <p className="muted small">
            These quarterly access reviews were generated at least 14 days ago and still have no
            reviewer signature. Open a report to review and sign it.
          </p>
          <ul>
            {overdue.map((row) => (
              <li key={row.reportId}>
                <button
                  type="button"
                  className="btn ghost"
                  data-testid={`access-review-overdue-link-${row.quarter}`}
                  onClick={() => openOverdueReport(row)}
                >
                  Open {row.quarter}
                </button>
                <span className="muted small"> ({row.reportId})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ns-member-form">
        <div className="ns-settings-grid">
          <label className="ns-settings-field">
            <span className="ns-settings-label">Quarter</span>
            <input
              type="text"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              placeholder="2026-Q4"
              disabled={loading}
            />
          </label>
        </div>

        <div className="btn-row ns-settings-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => void generateReport()}
            disabled={loading || !quarter}
          >
            <FileText size={14} aria-hidden="true" className="button-label-icon" />
            {loading ? 'Working…' : 'Generate Report'}
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
        </div>

        {loading && (
          <p role="status" aria-live="polite">Working on access review…</p>
        )}
        {error && (
          <p
            className="flash flash-error"
            role="alert"
            data-testid="access-review-privileged-error"
          >
            {error}
          </p>
        )}
      </div>

      {!report && !loading && !error && (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true" />
          <p className="muted">No report open yet.</p>
          <p className="muted small">
            Generate a quarter or open a stored report to review Principals, roles, grants, and last login.
          </p>
        </div>
      )}

      {report && (
        <div className="ns-settings-subsection">
          <h3>Report: {report.quarter}</h3>
          <p className="muted small">
            Generated {new Date(report.generatedAt).toLocaleString()}
          </p>

          <dl className="ns-settings-facts" aria-label="Access review summary">
            <div className="ns-settings-fact">
              <dt className="ns-settings-fact-label">Principals</dt>
              <dd className="ns-settings-fact-value">
                <span className="ns-tag ns-tag-muted">{report.principals.length}</span>
              </dd>
            </div>
            {report.reviewerSignature ? (
              <div
                className="ns-settings-fact ns-settings-fact-wide"
                data-testid="access-review-signature"
                aria-label="Reviewer signature identity"
              >
                <dt className="ns-settings-fact-label">Signature</dt>
                <dd className="ns-settings-fact-value">
                  <span className="status-pill ok">Signed</span>
                  <span className="muted small">Signed by:</span>
                  <UserRef
                    author={`${report.reviewerSignature.principal.iss}|${report.reviewerSignature.principal.sub}`}
                    name={report.reviewerSignature.principal.name}
                  />
                  <span className="muted small">
                    (
                    {new Date(report.reviewerSignature.signedAt)
                      .toISOString()
                      .slice(0, 10)}
                    )
                  </span>
                  {decideSignatureNameDisplay(
                    {
                      name: report.reviewerSignature.principal.name,
                      signedAt: report.reviewerSignature.signedAt,
                    },
                    currentName ?? undefined,
                  ).nowKnownAs ? (
                    <span className="muted small" data-testid="signature-now-known-as">
                      Now known as: {currentName}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : (
              <div className="ns-settings-fact ns-settings-fact-wide">
                <dt className="ns-settings-fact-label">Signature</dt>
                <dd className="ns-settings-fact-value" role="status">
                  <span className="status-pill warn">Awaiting signature</span>
                  <span className="muted small">
                    Sign report runs the signing ceremony against this report&apos;s hash.
                  </span>
                </dd>
              </div>
            )}
          </dl>

          <div className="btn-row ns-settings-actions">
            {!report.reviewerSignature && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void signReport()}
                disabled={loading || signing || !contentHash}
                aria-busy={signing || undefined}
              >
                <Shield size={14} aria-hidden="true" className="button-label-icon" />
                {signing ? 'Signing…' : 'Sign report'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={downloadReport}
              disabled={signing}
            >
              <Download size={14} aria-hidden="true" className="button-label-icon" />
              Download JSON
            </button>
          </div>

          {report.principals.length === 0 ? (
            <div className="empty-state" role="status">
              <span className="empty-state-icon" aria-hidden="true" />
              <p className="muted">This report has no Principals.</p>
            </div>
          ) : (
            <AccessReviewPrincipalTable
              principals={report.principals}
              page={principalPage}
              onPageChange={setPrincipalPage}
            />
          )}
        </div>
      )}
    </section>
  )
}

function AccessReviewPrincipalTable({
  principals,
  page,
  onPageChange,
}: {
  principals: AccessReviewReport['principals']
  page: number
  onPageChange: (page: number) => void
}) {
  const slice = paginate(principals, page, PRINCIPAL_PAGE_SIZE)
  return (
    <div className="auth-panel-stack">
      <div className="table-container">
        <table className="table" aria-label="Access review Principals">
          <thead>
            <tr>
              <th>Principal</th>
              <th>Roles</th>
              <th>Permissions</th>
              <th>Last Login</th>
            </tr>
          </thead>
          <tbody>
            {slice.items.map((p) => (
              <tr key={`${p.principal.iss}|${p.principal.sub}`}>
                <td>
                  <UserRef
                    author={`${p.principal.iss}|${p.principal.sub}`}
                    name={p.principal.name}
                  />
                </td>
                <td>
                  {p.roles.length > 0 ? (
                    <div className="ns-card-tags">
                      {p.roles.map((role) => (
                        <span key={role} className="ns-tag ns-tag-muted">{role}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {p.grants.length > 0 ? (
                    <div className="ns-card-tags">
                      {p.grants.map((grant) => (
                        <span key={grant} className="ns-tag ns-tag-muted">{grant}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {p.lastLogin ? (
                    <span className="small">{new Date(p.lastLogin).toLocaleDateString()}</span>
                  ) : (
                    <span className="muted">Never</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {slice.pageCount > 1 ? (
        <Pagination
          page={slice.page}
          pageCount={slice.pageCount}
          total={slice.total}
          onPageChange={onPageChange}
          label="Access review Principals pagination"
        />
      ) : null}
    </div>
  )
}
