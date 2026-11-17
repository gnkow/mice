import { History as ActionHistory, ShieldCheck as ActionShieldCheck, Trash2 as ActionTrash2, UserPlus as ActionUserPlus } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  fetchApproverHistory,
  fetchApprovers,
  grantApproverSeat,
  revokeApproverSeat,
  type ApproverPrincipal,
  type ApproverScope,
} from '../lib/authzApi'
import { UserRef } from './UserRef'
import { UserKeyLabel, VersionHistoryList } from './VersionHistory'

type Props = {
  namespace: string
  /** Omit for a namespace-wide seat; set for a repository-scoped seat. */
  repo?: string
}

function ApproverHistory({ scope }: { scope: ApproverScope }) {
  const state = useAsync((signal) => fetchApproverHistory(scope, signal), [scope.ns, scope.repo])
  return (
    <div className="ns-settings-subsection" data-testid="approver-history">
      <h3 className="ns-settings-subhead">Approver history</h3>
      <p className="muted small">
        Successive approver sets. Distinct from the Audit trail (who / why).
      </p>
      <VersionHistoryList
        state={state}
        label="Approver versions"
        emptyMessage="No versions recorded."
        renderBody={(v) =>
          v.approvers.length === 0 ? (
            <p className="muted small">No approvers</p>
          ) : (
            <ul className="muted small" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {v.approvers.map((a) => (
                <li key={`${a.iss}|${a.sub}`}>
                  <UserKeyLabel userKey={`${a.iss}|${a.sub}`} />
                </li>
              ))}
            </ul>
          )
        }
      />
    </div>
  )
}

/**
 * Owner-managed approver seats (GxP #86). Approvers are an explicit grant, never implied by Owner,
 * maintain or admin; they may sign merges into validated branches and revoke signatures.
 */
export function ApproversSection({ namespace, repo }: Props) {
  const scope: ApproverScope = repo ? { ns: namespace, repo } : { ns: namespace }
  const label = repo ? `${namespace}/${repo}` : namespace
  const headingId = useId()
  const subId = useId()
  const issId = useId()
  const state = useAsync((signal) => fetchApprovers(scope, signal), [namespace, repo])
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState('mice-dev')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)

  async function change(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      state.reload()
      setHistoryKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approver change failed')
    } finally {
      setBusy(false)
    }
  }

  function onGrant(e: FormEvent) {
    e.preventDefault()
    const target = { sub: sub.trim(), iss: iss.trim() }
    if (!target.sub || !target.iss) {
      setError('Enter the approver’s subject (sub) and issuer (iss)')
      return
    }
    void change(async () => {
      await grantApproverSeat(scope, target)
      setSub('')
    }, `Assigned approver role to ${target.sub}`)
  }

  function onRevoke(a: ApproverPrincipal) {
    void change(() => revokeApproverSeat(scope, a), `Removed approver role from ${a.sub}`)
  }

  const approvers = state.kind === 'ok' ? state.data.approvers : []

  return (
    <section
      id={repo ? 'repo-approvers' : 'ns-approvers'}
      className="settings-section"
      aria-labelledby={headingId}
      data-testid="approvers-section"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id={headingId}>
            <ActionShieldCheck size={18} className="button-label-icon" aria-hidden="true" />
            Approvers
          </h2>
          <p className="muted small">
            Approvers {repo ? 'on this repository' : 'across this namespace'} may sign merges into validated
            branches and revoke signatures for <code>{label}</code>. The role is an explicit grant; Owner,
            maintain and admin never imply it. Only Owners can change it.
          </p>
        </div>
        <p className="muted small ns-settings-count">
          {state.kind === 'ok'
            ? `${approvers.length} approver${approvers.length === 1 ? '' : 's'}`
            : null}
        </p>
      </div>

      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="flash flash-success" role="status">
          {notice}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="muted small" role="status" aria-live="polite">
          Loading approvers…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div className="flash flash-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn ghost" onClick={() => state.reload()}>
            Retry
          </button>
        </div>
      ) : null}
      {state.kind === 'ok' && approvers.length === 0 ? (
        <p className="muted small">No approvers assigned.</p>
      ) : null}
      {approvers.length > 0 ? (
        <ul className="ns-member-list" aria-label={`Approvers for ${label}`}>
          {approvers.map((a) => (
            <li key={`${a.iss}|${a.sub}`} className="ns-member-row" data-testid="approver-row">
              <div className="ns-member-main">
                <UserRef author={`${a.iss}|${a.sub}`} />
              </div>
              <span className="ns-tag ns-tag-accent">approver</span>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                aria-label={`Revoke approver ${a.sub}`}
                onClick={() => onRevoke(a)}
              >
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="ns-member-form" onSubmit={onGrant} aria-label="Assign approver">
        <h3 className="ns-settings-subhead">Assign approver</h3>
        <div className="ns-member-form-fields cols-2">
          <label htmlFor={subId}>
            Approver subject (sub)
            <input
              id={subId}
              value={sub}
              disabled={busy}
              onChange={(e) => setSub(e.target.value)}
              placeholder="user-sub"
              autoComplete="off"
              required
            />
          </label>
          <label htmlFor={issId}>
            Approver issuer (iss)
            <input
              id={issId}
              value={iss}
              disabled={busy}
              onChange={(e) => setIss(e.target.value)}
              placeholder="mice-dev"
              autoComplete="off"
              required
            />
          </label>
        </div>
        <div className="ns-member-form-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />
            Assign approver
          </button>
          <button
            className="btn ghost"
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />
            {showHistory ? 'Hide approver history' : 'Approver history'}
          </button>
        </div>
      </form>

      {showHistory ? <ApproverHistory key={historyKey} scope={scope} /> : null}
    </section>
  )
}
