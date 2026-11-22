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
import type { PrincipalProfiles } from '../lib/commitEmail'
import { decideUserRefLabel } from '../lib/userRef'
import { usePrincipalProfiles } from './CommitEmail'
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

function userAuthorKey(a: Extract<ApproverPrincipal, { kind: 'user' }>): string {
  return `${a.iss}|${a.sub}`
}

/** Human label for flashes / aria — never the raw UUID alone when a name/email is known. */
export function approverWhoLabel(
  a: ApproverPrincipal,
  profiles: PrincipalProfiles,
  hint?: { name?: string; email?: string },
): string {
  if (a.kind === 'group') return a.name?.trim() || a.group
  const key = userAuthorKey(a)
  return decideUserRefLabel({
    author: key,
    name: hint?.name?.trim() || profiles.names[key],
    email: hint?.email?.trim() || profiles.emails[key],
  })
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

  const approvers = state.kind === 'ok' ? state.data.approvers : []
  const userAuthors = approvers
    .filter((a): a is Extract<ApproverPrincipal, { kind: 'user' }> => a.kind === 'user')
    .map(userAuthorKey)
  const profiles = usePrincipalProfiles(userAuthors)

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
    const who = approverWhoLabel(a, profiles)
    void change(
      () => revokeApproverSeat(scope, a),
      `Removed approver role from ${who}`,
    ).catch(() => {})
  }

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
            Explicit seat to sign merges into validated branches
            {repo ? ' on this repository' : ' across this namespace'}. Not implied by Owner,
            maintain, or admin
            {!canManage ? ' (view only)' : ''}.
          </p>
        </div>
        {state.kind === 'ok' ? (
          <span
            className={`status-pill ${approvers.length > 0 ? 'ok' : 'neutral'}`}
            role="status"
            aria-label={`${approvers.length} approver${approvers.length === 1 ? '' : 's'}`}
          >
            {approvers.length === 1 ? '1 approver' : `${approvers.length} approvers`}
          </span>
        ) : null}
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
                  <UserRef author={userAuthorKey(a)} profiles={profiles} />
                )}
              </div>
              <span className="status-pill active">approver</span>
              {canManage ? (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  aria-label={`Revoke approver ${approverWhoLabel(a, profiles)}`}
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
                principal.kind === 'group'
                  ? principal.name || principal.group
                  : approverWhoLabel(target, profiles, {
                      name: principal.name,
                      email: principal.email,
                    })
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
