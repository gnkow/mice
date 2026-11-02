import { Check as ActionCheck, Search as ActionSearch, X as ActionX } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { formatScope, type PatScope } from '../lib/tokens'

type DeviceStatus = {
  userCode: string
  status: string
  expiresAt: string
  expired: boolean
  scopes?: PatScope[]
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

async function postDeviceAction(
  action: 'approve' | 'deny',
  userCode: string,
  confirmation?: string,
): Promise<void> {
  const res = await fetch(`/auth/cli/device/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'approve' ? { user_code: userCode, confirmation } : { user_code: userCode }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to ${action}`)
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
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const canApprove =
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      authz.data.instanceAdmin ||
      authz.data.permissions.cli_device_approve)

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
  
  // Ticket 25: Require typing "APPROVE" or the full device code
  const confirmValid = confirmInput.trim().toUpperCase() === 'APPROVE' || confirmInput.trim().toUpperCase() === lookup?.userCode
  const canSubmitApprove = canAct && confirmValid

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
          <label>
            Device code
            <input
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
              <ActionSearch size={14} aria-hidden="true" className="button-label-icon" />Look up
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
            
            {/* Ticket 25: Show hashed IP (last 4 chars) and device name */}
            {canAct && (lookup.requestHashedIp || lookup.deviceName) && (
              <div className="cli-device-info">
                {lookup.requestHashedIp && (
                  <p className="muted small">
                    <strong>Request from:</strong> ...{lookup.requestHashedIp.slice(-4)}
                  </p>
                )}
                {lookup.deviceName && (
                  <p className="muted small">
                    <strong>Device:</strong> {lookup.deviceName}
                  </p>
                )}
              </div>
            )}
            
            {/* Ticket 25: Require typing confirmation */}
            {canAct && (
              <>
                <label className="cli-confirm-label">
                  <span>Type <strong>APPROVE</strong> or <strong>{lookup.userCode}</strong> to confirm:</span>
                  <input
                    className="mono"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder="APPROVE"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </label>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canSubmitApprove || busy}
                    onClick={() => void onApprove()}
                  >
                    <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />Approve
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void onDeny()}
                  >
                    <ActionX size={14} aria-hidden="true" className="button-label-icon" />Deny
                  </button>
                </div>
              </>
            )}
            {done === 'approved' && (
              <div className="flash" role="status">
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
          <p className="flash flash-error" role="alert">
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
