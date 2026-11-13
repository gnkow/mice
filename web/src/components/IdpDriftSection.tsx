import { GitCompare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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

const emptyForm: DriftForm = {
  amr: '',
  scopes: 'openid, profile, email',
  signatureAlgorithm: 'RS256',
  groupClaimFormat: 'array',
}

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
      setNotice('Drift check stored')
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
      setNotice('Baseline saved')
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
            <div className="ns-settings-grid">
              <div className="ns-settings-field">
                <span className="ns-settings-label">Current baseline</span>
                <p className="muted small">
                  {when(baseline.establishedAt)} by <code className="inline-code">{baseline.establishedBy}</code>
                </p>
              </div>
              <div className="ns-settings-field">
                <span className="ns-settings-label">Issuer</span>
                <p className="muted small">{baseline.issuer}</p>
              </div>
              <div className="ns-settings-field">
                <span className="ns-settings-label">MFA claims</span>
                <p className="muted small">
                  acr {baseline.mfaClaimsAvailable.acr || '(none)'}; amr {baseline.mfaClaimsAvailable.amr.join(', ') || '(none)'}
                </p>
              </div>
              <div className="ns-settings-field">
                <span className="ns-settings-label">Scopes, algorithm, groups</span>
                <p className="muted small">
                  {baseline.requiredScopes.join(', ') || '(none)'} · {baseline.signatureAlgorithm} · {baseline.groupClaimFormat}
                </p>
              </div>
            </div>
          ) : (
            <div className="empty-state" role="status">
              <span className="empty-state-icon" aria-hidden="true" />
              <p className="muted">No IdP baseline is stored.</p>
              <p className="muted small">The daily check waits until one is saved below.</p>
            </div>
          )}

          <div className="btn-row ns-settings-actions">
            <button className="btn primary" type="button" onClick={() => void checkNow()} disabled={busy !== null || !baseline}>
              {busy === 'check' ? 'Checking…' : 'Check now'}
            </button>
            <button className="btn ghost" type="button" onClick={useLatestCheck} disabled={!latestUsable || busy !== null}>
              Fill from latest check
            </button>
          </div>

          {reports.length > 0 ? (
            <ul className="ns-member-list">
              {reports.map((report) => (
                <li key={report.id ?? report.checkedAt} className="ns-member-row">
                  <div className="ns-member-main">
                    <span>{when(report.checkedAt)}</span>
                    <span className="muted small ns-member-sub">
                      {report.error
                        ? report.error
                        : report.hasCriticalDrift
                          ? `Critical: ${report.criticalDrifts.join('; ')}`
                          : report.hasNonCriticalDrift
                            ? `Recorded: ${report.nonCriticalDrifts.join('; ')}`
                            : 'No drift'}
                    </span>
                  </div>
                  {report.hasCriticalDrift && (
                    <span className="flash flash-error" role="status">Signing blocked</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state" role="status">
              <span className="empty-state-icon" aria-hidden="true" />
              <p className="muted">No drift reports yet.</p>
              <p className="muted small">Run Check now after a baseline is saved.</p>
            </div>
          )}

          <form className="ns-member-form" onSubmit={(event) => void saveBaseline(event)}>
            <h3 className="ns-settings-subhead">Replace baseline</h3>
            <div className="ns-settings-grid">
              <label className="ns-settings-field">
                <span className="ns-settings-label">MFA amr claims</span>
                <input
                  value={form.amr}
                  onChange={(event) => setForm((current) => ({ ...current, amr: event.target.value }))}
                  placeholder="pwd, otp"
                  disabled={busy !== null}
                />
              </label>
              <label className="ns-settings-field">
                <span className="ns-settings-label">Required scopes</span>
                <input
                  value={form.scopes}
                  onChange={(event) => setForm((current) => ({ ...current, scopes: event.target.value }))}
                  disabled={busy !== null}
                />
              </label>
              <label className="ns-settings-field">
                <span className="ns-settings-label">Signature algorithm</span>
                <input
                  value={form.signatureAlgorithm}
                  onChange={(event) => setForm((current) => ({ ...current, signatureAlgorithm: event.target.value }))}
                  disabled={busy !== null}
                />
              </label>
              <label className="ns-settings-field">
                <span className="ns-settings-label">Group-claim format</span>
                <input
                  value={form.groupClaimFormat}
                  onChange={(event) => setForm((current) => ({ ...current, groupClaimFormat: event.target.value }))}
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
