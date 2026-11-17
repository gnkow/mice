import { GitCompare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { usePrincipalProfiles } from './CommitEmail'
import { PAGE_SIZE, Pagination, paginate } from './Pagination'
import { UserRef } from './UserRef'

type MfaClaims = { acr?: string; amr: string[] }

type Baseline = {
  id: number
  establishedAt: string
  establishedBy: string
  mfaClaimsAvailable: MfaClaims
  requiredScopes: string[]
  signatureAlgorithm: string
  groupClaimFormat: string
  issuer: string
}

type CurrentConfig = {
  mfaClaimsAvailable?: MfaClaims
  requiredScopes: string[]
  signatureAlgorithm: string
  groupClaimFormat: string
  issuer: string
}

type DriftReport = {
  id?: number
  checkedAt?: string
  hasCriticalDrift: boolean
  hasNonCriticalDrift: boolean
  criticalDrifts: string[]
  nonCriticalDrifts: string[]
  currentConfig: CurrentConfig
  error?: string
}

type DriftForm = {
  amr: string
  scopes: string
  signatureAlgorithm: string
  groupClaimFormat: string
}

/** Explicit starter defaults before a baseline exists (also used as input placeholders). */
const FORM_DEFAULTS: DriftForm = {
  amr: 'pwd, otp',
  scopes: 'openid, profile, email',
  signatureAlgorithm: 'RS256',
  groupClaimFormat: 'array',
}

const emptyForm: DriftForm = { ...FORM_DEFAULTS }

function formFrom(baseline: Baseline): DriftForm {
  return {
    amr: baseline.mfaClaimsAvailable.amr.join(', '),
    scopes: baseline.requiredScopes.join(', '),
    signatureAlgorithm: baseline.signatureAlgorithm,
    groupClaimFormat: baseline.groupClaimFormat,
  }
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

function when(value: string | undefined): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function IdpDriftSection() {
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [reports, setReports] = useState<DriftReport[]>([])
  const [form, setForm] = useState<DriftForm>(emptyForm)
  const [busy, setBusy] = useState<'check' | 'save' | 'load' | null>('load')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reportPage, setReportPage] = useState(1)

  const load = useCallback(async () => {
    const [baselineRes, reportsRes] = await Promise.all([
      fetch('/auth/admin/idp-drift/baseline', { credentials: 'same-origin' }),
      fetch('/auth/admin/idp-drift/reports', { credentials: 'same-origin' }),
    ])
    if (baselineRes.status === 404) {
      setBaseline(null)
    } else if (baselineRes.ok) {
      const body = await baselineRes.json() as { baseline: Baseline }
      setBaseline(body.baseline)
      setForm(formFrom(body.baseline))
    } else {
      const body = await baselineRes.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || 'Failed to load the IdP baseline')
    }
    if (!reportsRes.ok) {
      const body = await reportsRes.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error || 'Failed to load drift reports')
    }
    const reportsBody = await reportsRes.json() as { reports: DriftReport[] }
    setReports(reportsBody.reports ?? [])
    setReportPage(1)
  }, [])

  const refresh = useCallback(async () => {
    setBusy('load')
    setLoadError(null)
    setError(null)
    try {
      await load()
      setLoaded(true)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load IdP drift')
      setLoaded(true)
    } finally {
      setBusy(null)
    }
  }, [load])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function checkNow() {
    setBusy('check')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/auth/admin/idp-drift/check', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = await res.json() as { error?: string; detail?: string }
      if (!res.ok) throw new Error(body.detail || body.error || 'Drift check failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drift check failed')
    } finally {
      setBusy(null)
    }
  }

  async function saveBaseline(event: { preventDefault(): void }) {
    event.preventDefault()
    const amr = splitList(form.amr)
    const requiredScopes = splitList(form.scopes)
    if (!requiredScopes.length || !form.signatureAlgorithm.trim() || !form.groupClaimFormat.trim()) {
      setError('Scopes, signature algorithm, and group-claim format are required')
      return
    }
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/auth/admin/idp-drift/baseline', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mfaClaimsAvailable: { amr },
          requiredScopes,
          signatureAlgorithm: form.signatureAlgorithm.trim(),
          groupClaimFormat: form.groupClaimFormat.trim(),
        }),
      })
      const body = await res.json() as { error?: string; detail?: string }
      if (!res.ok) throw new Error(body.detail || body.error || 'Failed to save the baseline')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the baseline')
    } finally {
      setBusy(null)
    }
  }

  function useLatestCheck() {
    const latest = reports.find((report) => !report.error && report.currentConfig.signatureAlgorithm)
    if (!latest) return
    const claims = latest.currentConfig.mfaClaimsAvailable ?? baseline?.mfaClaimsAvailable
    setForm({
      amr: claims?.amr.join(', ') ?? '',
      scopes: latest.currentConfig.requiredScopes.join(', '),
      signatureAlgorithm: latest.currentConfig.signatureAlgorithm,
      groupClaimFormat: latest.currentConfig.groupClaimFormat,
    })
    setNotice('Form filled from the latest check. Save the baseline to accept it.')
    setError(null)
  }

  const latestUsable = reports.some((report) => !report.error && report.currentConfig.signatureAlgorithm)
  const establishedBy = baseline?.establishedBy ?? ''
  const profiles = usePrincipalProfiles(establishedBy ? [establishedBy] : [])
  const reportSlice = paginate(reports, reportPage, PAGE_SIZE)

  return (
    <section id="idp-drift" className="settings-section" aria-labelledby="idp-drift-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="idp-drift-heading">
            <GitCompare size={18} className="button-label-icon" aria-hidden="true" />
            IdP drift
          </h2>
          <p className="muted small">
            Compare the stored identity-provider baseline with discovery. Critical drift blocks signing until an admin accepts a new baseline.
          </p>
        </div>
      </div>

      {busy === 'load' && !loaded && (
        <p role="status" aria-live="polite">Loading IdP drift…</p>
      )}

      {loadError && (
        <div className="flash flash-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn ghost" onClick={() => void refresh()}>
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}
      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {notice && <p className="flash flash-success" role="status">{notice}</p>}

      {loaded && !loadError && (
        <>
          {baseline ? (
            <dl className="ns-settings-facts">
              <div className="ns-settings-fact ns-settings-fact-wide">
                <dt className="ns-settings-fact-label">Established</dt>
                <dd className="ns-settings-fact-value">
                  <span>{when(baseline.establishedAt)}</span>
                  <span className="muted">by</span>
                  <UserRef author={baseline.establishedBy} profiles={profiles} />
                </dd>
              </div>
              <div className="ns-settings-fact ns-settings-fact-wide">
                <dt className="ns-settings-fact-label">Issuer</dt>
                <dd className="ns-settings-fact-value">
                  <code className="inline-code">{baseline.issuer}</code>
                </dd>
              </div>
              <div className="ns-settings-fact">
                <dt className="ns-settings-fact-label">MFA claims</dt>
                <dd className="ns-settings-fact-value">
                  <span className="ns-tag ns-tag-muted">
                    acr {baseline.mfaClaimsAvailable.acr || 'none'}
                  </span>
                  <span className="ns-tag ns-tag-muted">
                    amr {baseline.mfaClaimsAvailable.amr.join(', ') || 'none'}
                  </span>
                </dd>
              </div>
              <div className="ns-settings-fact">
                <dt className="ns-settings-fact-label">Algorithm</dt>
                <dd className="ns-settings-fact-value">
                  <span className="ns-tag ns-tag-muted">{baseline.signatureAlgorithm}</span>
                  <span className="ns-tag ns-tag-muted">{baseline.groupClaimFormat}</span>
                </dd>
              </div>
              <div className="ns-settings-fact ns-settings-fact-wide">
                <dt className="ns-settings-fact-label">Scopes</dt>
                <dd className="ns-settings-fact-value">
                  {baseline.requiredScopes.length > 0
                    ? baseline.requiredScopes.map((scope) => (
                        <span key={scope} className="ns-tag ns-tag-muted">{scope}</span>
                      ))
                    : <span className="muted">none</span>}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="empty-state" role="status">
              <span className="empty-state-icon" aria-hidden="true" />
              <p className="muted">No IdP baseline is stored.</p>
              <p className="muted small">The daily check waits until one is saved below.</p>
            </div>
          )}

          <div className="btn-row ns-settings-actions">
            <button
              className="btn primary"
              type="button"
              onClick={() => void checkNow()}
              disabled={busy !== null || !baseline}
              title={!baseline ? 'Save a baseline below first' : undefined}
            >
              {busy === 'check' ? 'Checking…' : 'Check now'}
            </button>
            <button className="btn ghost" type="button" onClick={useLatestCheck} disabled={!latestUsable || busy !== null}>
              Fill from latest check
            </button>
          </div>

          {reports.length > 0 ? (
            <>
              <ul className="ns-member-list" aria-label="IdP drift reports">
                {reportSlice.items.map((report) => {
                  const findings = report.error
                    ? [report.error]
                    : report.hasCriticalDrift
                      ? report.criticalDrifts
                      : report.hasNonCriticalDrift
                        ? report.nonCriticalDrifts
                        : []
                  return (
                    <li key={report.id ?? report.checkedAt} className="ns-member-row">
                      <div className="ns-member-main">
                        <span>{when(report.checkedAt)}</span>
                        {findings.length > 0 ? (
                          <ul className="muted small ns-member-sub idp-drift-findings">
                            {findings.map((finding) => (
                              <li key={finding}>{finding}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted small ns-member-sub">No drift</span>
                        )}
                      </div>
                      {report.hasCriticalDrift && (
                        <span className="flash flash-error" role="status">Signing blocked</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {reportSlice.pageCount > 1 ? (
                <Pagination
                  page={reportSlice.page}
                  pageCount={reportSlice.pageCount}
                  total={reportSlice.total}
                  onPageChange={setReportPage}
                  label="IdP drift report pagination"
                />
              ) : null}
            </>
          ) : (
            <div className="empty-state" role="status">
              <span className="empty-state-icon" aria-hidden="true" />
              <p className="muted">No drift reports yet.</p>
              <p className="muted small">Run Check now after a baseline is saved.</p>
            </div>
          )}

          <form className="ns-member-form" onSubmit={(event) => void saveBaseline(event)}>
            <h3 className="ns-settings-subhead">Replace baseline</h3>
            <p className="muted small">
              Explicit accepted values for the next check. Issuer comes from{' '}
              <code className="inline-code">OIDC_ISSUER</code> (not editable here). Defaults:{' '}
              <code className="inline-code">{FORM_DEFAULTS.amr}</code>,{' '}
              <code className="inline-code">{FORM_DEFAULTS.scopes}</code>,{' '}
              <code className="inline-code">{FORM_DEFAULTS.signatureAlgorithm}</code>,{' '}
              <code className="inline-code">{FORM_DEFAULTS.groupClaimFormat}</code>. Use Fill from
              latest check to copy discovery scopes/algorithm.
            </p>
            <div className="ns-member-form-fields cols-2-fields">
              <label>
                MFA amr claims
                <input
                  value={form.amr}
                  onChange={(event) => setForm((current) => ({ ...current, amr: event.target.value }))}
                  placeholder={FORM_DEFAULTS.amr}
                  disabled={busy !== null}
                />
              </label>
              <label>
                Required scopes
                <input
                  value={form.scopes}
                  onChange={(event) => setForm((current) => ({ ...current, scopes: event.target.value }))}
                  placeholder={FORM_DEFAULTS.scopes}
                  disabled={busy !== null}
                />
              </label>
              <label>
                Signature algorithm
                <input
                  value={form.signatureAlgorithm}
                  onChange={(event) => setForm((current) => ({ ...current, signatureAlgorithm: event.target.value }))}
                  placeholder={FORM_DEFAULTS.signatureAlgorithm}
                  disabled={busy !== null}
                />
              </label>
              <label>
                Group-claim format
                <input
                  value={form.groupClaimFormat}
                  onChange={(event) => setForm((current) => ({ ...current, groupClaimFormat: event.target.value }))}
                  placeholder={FORM_DEFAULTS.groupClaimFormat}
                  disabled={busy !== null}
                />
              </label>
            </div>
            <div className="btn-row ns-settings-actions">
              <button className="btn primary" type="submit" disabled={busy !== null}>
                {busy === 'save' ? 'Saving…' : 'Save baseline'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
