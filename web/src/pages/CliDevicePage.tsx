import {
  Check as ActionCheck,
  Search as ActionSearch,
  ShieldAlert,
  X as ActionX,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe, hasEffectivePermission } from '../lib/auth'
import { isApprovalConfirmation } from '../lib/cliDeviceApproval'
import { formatScope, type CliCredentialScope } from '../lib/tokens'

type DeviceStatus = {
  userCode: string
  status: string
  expiresAt: string
  expired: boolean
  scopes?: CliCredentialScope[]
  deviceName?: string
  requestHashedIp?: string
}

async function fetchDeviceStatus(
  userCode: string,
  signal?: AbortSignal,
): Promise<DeviceStatus> {
  const res = await fetch(
    `/auth/cli/device/status?user_code=${encodeURIComponent(userCode)}`,
    { credentials: 'same-origin', signal },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Unknown user code')
  }
  return (await res.json()) as DeviceStatus
}

function formatDeviceActionError(
  action: 'approve' | 'deny',
  status: number,
  body: { error?: string; limit?: number } | null,
): string {
  if (action === 'approve' && status === 429) {
    const limit = body?.limit ?? 5
    // Prefer explicit API copy; otherwise a clear "too many attempts" alert (ticket 24).
    if (body?.error?.trim()) return body.error
    return `Too many attempts: device approvals are limited to ${limit} per 10 minutes. Wait, then try again.`
  }
  return body?.error ?? `Failed to ${action}`
}

async function postDeviceAction(
  action: 'approve' | 'deny',
  userCode: string,
  confirmation?: string,
): Promise<void> {
  const res = await fetch(`/auth/cli/device/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      action === 'approve'
        ? { user_code: userCode, confirmation }
        : { user_code: userCode },
    ),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
      limit?: number
    } | null
    throw new Error(formatDeviceActionError(action, res.status, body))
  }
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export function CliDevicePage() {
  const [params] = useSearchParams()
  const preset = params.get('user_code') ?? ''
  const [codeInput, setCodeInput] = useState(preset)
  const [activeCode, setActiveCode] = useState(
    () => (preset ? normalizeCode(preset) : ''),
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')
  const actionErrorRef = useRef<HTMLParagraphElement>(null)
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const canApprove =
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      hasEffectivePermission(authz.data, 'cli_device:approve'))

  const status = useAsync(
    (signal) =>
      activeCode
        ? fetchDeviceStatus(activeCode, signal)
        : Promise.resolve(null),
    [activeCode],
  )

  useEffect(() => {
    if (preset) setCodeInput(preset)
  }, [preset])

  useEffect(() => {
    if (actionError) actionErrorRef.current?.focus()
  }, [actionError])

  function onLookup(e: FormEvent) {
    e.preventDefault()
    setActionError(null)
    setDone(null)
    setConfirmInput('')
    setActiveCode(normalizeCode(codeInput))
  }

  async function onApprove() {
    if (!activeCode) return
    setBusy(true)
    setActionError(null)
    try {
      await postDeviceAction('approve', activeCode, confirmInput)
      setDone('approved')
      status.reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  async function onDeny() {
    if (!activeCode) return
    setBusy(true)
    setActionError(null)
    try {
      await postDeviceAction('deny', activeCode)
      setDone('denied')
      status.reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Deny failed')
    } finally {
      setBusy(false)
    }
  }

  const lookup = status.kind === 'ok' ? status.data : null
  const canAct =
    !!canApprove &&
    !!lookup &&
    !lookup.expired &&
    lookup.status === 'pending' &&
    done === null

  const canSubmitApprove =
    canAct && isApprovalConfirmation(confirmInput, lookup?.userCode)
  const confirmHintId = 'cli-device-confirm-hint'
  const confirmErrorId = 'cli-device-action-error'
  const hashedIpLabelId = 'cli-hashed-ip-label'
  const securityWarningId = 'cli-device-security-warning'

  return (
    <div className="login-shell">
      <main className="page narrow login-page">
        <p className="login-brand">MICE</p>
        <h1>Authorize CLI</h1>
        <p className="lede">
          Enter the code shown in your terminal to link your command-line session to this account.
        </p>
        {!canApprove && authz.kind === 'ok' && authz.data?.enforce ? (
          <p className="flash flash-warn" role="status">
            You need permission to approve command-line login requests.
          </p>
        ) : null}

        <form className="cli-device-form" onSubmit={onLookup}>
          <label htmlFor="cli-device-code">
            Device code
            <input
              id="cli-device-code"
              className="mono"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          <div className="btn-row">
            <button className="btn" type="submit" disabled={!codeInput.trim()}>
              <ActionSearch size={14} aria-hidden="true" className="button-label-icon" />
              Look up
            </button>
          </div>
        </form>

        {status.kind === 'error' && activeCode && (
          <p className="flash flash-error" role="alert">
            {status.message}
          </p>
        )}

        {lookup && (
          <div className="cli-device-status">
            <p>
              Code <code className="mono">{lookup.userCode}</code>
              {lookup.expired
                ? ' has expired.'
                : lookup.status === 'pending'
                  ? ' is waiting for approval.'
                  : ` is ${lookup.status}.`}
            </p>
            <p className="muted small">
              {lookup.scopes?.length
                ? `Requested access limited to: ${lookup.scopes.map(formatScope).join(', ')}`
                : 'Requested access: your full account permissions.'}
            </p>

            {canAct && (
              <div
                id={securityWarningId}
                className="flash flash-warn cli-device-security-warning"
                role="status"
                aria-live="polite"
              >
                <p className="cli-device-security-warning-title">
                  <ShieldAlert
                    size={16}
                    aria-hidden="true"
                    className="button-label-icon"
                  />
                  Security warning
                </p>
                <p>
                  Only approve a code you started in your own terminal. Attackers
                  may send codes by email or chat to steal CLI access. Approvals
                  are limited to 5 per 10 minutes; exceeding that blocks further
                  approvals until the window resets.
                </p>
              </div>
            )}

            {canAct && (lookup.requestHashedIp || lookup.deviceName) && (
              <dl className="cli-device-info">
                {lookup.requestHashedIp && (
                  <div className="cli-device-info-row">
                    <dt id={hashedIpLabelId}>Hashed IP suffix</dt>
                    <dd>
                      <code
                        className="mono cli-hashed-ip-suffix"
                        aria-labelledby={hashedIpLabelId}
                        title={`Last 4 hex characters of the salted request IP hash: ${lookup.requestHashedIp}`}
                      >
                        {lookup.requestHashedIp}
                      </code>
                      <span className="muted small cli-hashed-ip-hint">
                        Last 4 hex of the salted request fingerprint (not a raw
                        IP). Compare with the machine that started this login.
                      </span>
                    </dd>
                  </div>
                )}
                {lookup.deviceName && (
                  <div className="cli-device-info-row">
                    <dt>Device name</dt>
                    <dd>{lookup.deviceName}</dd>
                  </div>
                )}
              </dl>
            )}

            {canAct && (
              <>
                <label className="cli-confirm-label" htmlFor="cli-device-confirm">
                  <span>
                    Type <strong>APPROVE</strong> or{' '}
                    <strong className="mono">{lookup.userCode}</strong> to confirm
                    this device:
                  </span>
                  <input
                    id="cli-device-confirm"
                    className="mono"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder="APPROVE"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby={
                      [
                        confirmHintId,
                        securityWarningId,
                        actionError ? confirmErrorId : null,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    aria-invalid={
                      confirmInput.trim().length > 0 && !canSubmitApprove
                        ? true
                        : undefined
                    }
                  />
                </label>
                <p id={confirmHintId} className="muted small cli-confirm-hint">
                  {canSubmitApprove
                    ? 'Confirmation matches. You can approve or deny.'
                    : 'Approve stays disabled until the confirmation matches APPROVE or the device code exactly.'}
                </p>
                <div className="btn-row cli-device-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canSubmitApprove || busy}
                    aria-busy={busy || undefined}
                    aria-describedby={confirmHintId}
                    onClick={() => void onApprove()}
                  >
                    <ActionCheck
                      size={14}
                      aria-hidden="true"
                      className="button-label-icon"
                    />
                    {busy ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => void onDeny()}
                  >
                    <ActionX
                      size={14}
                      aria-hidden="true"
                      className="button-label-icon"
                    />
                    Deny
                  </button>
                </div>
              </>
            )}
            {done === 'approved' && (
              <div className="flash flash-success" role="status">
                <p>
                  Approved. Return to your terminal — login should complete shortly.
                </p>
              </div>
            )}
            {done === 'denied' && (
              <div className="flash flash-warn" role="status">
                <p>Denied. The login request was cancelled.</p>
              </div>
            )}
          </div>
        )}

        {actionError && (
          <p
            ref={actionErrorRef}
            id={confirmErrorId}
            className="flash flash-error"
            role="alert"
            tabIndex={-1}
          >
            {actionError}
          </p>
        )}

        <p className="muted small">
          <Link to="/">Back to Mice</Link>
        </p>
      </main>
    </div>
  )
}
