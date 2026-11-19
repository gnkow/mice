import { ShieldCheck as ActionShieldCheck, Trash2 as ActionTrash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  fetchApprovers,
  grantApproverSeat,
  revokeApproverSeat,
  type ApproverPrincipal,
  type ApproverScope,
} from '../lib/authzApi'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { GroupPrincipalLabel } from './GroupPrincipalLabel'
import { PrincipalAddCard } from './PrincipalAddCard'
import { UserRef } from './UserRef'

type Props = {
  namespace: string
  /** Omit for a namespace-wide seat; set for a repository-scoped seat. */
  repo?: string
  /** When false, list only (no assign/revoke). Defaults to true for repo settings call sites. */
  canManage?: boolean
}

function approverKey(a: ApproverPrincipal): string {
  return a.kind === 'group' ? `group:${a.group}` : `user:${a.iss}|${a.sub}`
}

/**
 * Owner-managed approver seats (GxP #86). Approvers are an explicit grant, never implied by Owner,
 * maintain or admin; they may sign merges into validated branches and revoke signatures.
 * Seats may be users or IdP groups. History lives in the settings History nav.
 */
export function ApproversSection({
  namespace,
  repo,
  canManage = true,
}: Props) {
  const scope: ApproverScope = repo ? { ns: namespace, repo } : { ns: namespace }
  const label = repo ? `${namespace}/${repo}` : namespace
  const headingId = useId()
  const state = useAsync((signal) => fetchApprovers(scope, signal), [namespace, repo])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function change(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      state.reload()
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setError(err instanceof Error ? err.message : 'Approver change failed')
      throw err
    } finally {
      setBusy(false)
    }
  }

  function onRevoke(a: ApproverPrincipal) {
    const who =
      a.kind === 'group' ? a.name || a.group : a.sub
    void change(
      () => revokeApproverSeat(scope, a),
      `Removed approver role from ${who}`,
    ).catch(() => {})
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
            Sign merges into validated branches
            {repo ? ' on this repository' : ' across this namespace'}. Explicit
            grant — not implied by Owner or admin
            {!canManage ? ' (view only for you)' : ''}. Users or groups.
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
            <li key={approverKey(a)} className="ns-member-row" data-testid="approver-row">
              <div className="ns-member-main">
                {a.kind === 'group' ? (
                  <GroupPrincipalLabel group={a.group} name={a.name} inline />
                ) : (
                  <UserRef author={`${a.iss}|${a.sub}`} />
                )}
              </div>
              <span className="ns-tag ns-tag-accent">approver</span>
              {canManage ? (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  aria-label={
                    a.kind === 'group'
                      ? `Revoke approver group ${a.name || a.group}`
                      : `Revoke approver ${a.sub}`
                  }
                  onClick={() => onRevoke(a)}
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <div className="ns-member-form" aria-label="Assign approver">
          <h3 className="ns-settings-subhead">Assign approver</h3>
          <PrincipalAddCard
            disabled={busy}
            addLabel="Assign approver"
            onAdd={async (principal) => {
              const target: ApproverPrincipal =
                principal.kind === 'group'
                  ? { kind: 'group', group: principal.group, name: principal.name }
                  : { kind: 'user', sub: principal.sub, iss: principal.iss }
              const who =
                target.kind === 'group' ? target.name || target.group : target.sub
              await change(
                () => grantApproverSeat(scope, target),
                `Assigned approver role to ${who}`,
              )
            }}
          />
        </div>
      ) : null}
    </section>
  )
}
