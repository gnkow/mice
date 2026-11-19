import { History as ActionHistory, ShieldCheck as ActionShieldCheck, Trash2 as ActionTrash2, UserPlus as ActionUserPlus } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  fetchApproverHistory,
  fetchApprovers,
  fetchRepoCollaborators,
  grantApproverSeat,
  revokeApproverSeat,
  type ApproverPrincipal,
  type ApproverScope,
  type CollaboratorPrincipal,
} from '../lib/authzApi'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { decideUserRefLabel } from '../lib/userRef'
import { usePrincipalProfiles } from './CommitEmail'
import { DirectoryPicker } from './DirectoryPicker'
import { UserRef } from './UserRef'
import { ApproverVersionSeats, VersionHistoryList } from './VersionHistory'

type Props = {
  namespace: string
  /** Omit for a namespace-wide seat; set for a repository-scoped seat. */
  repo?: string
  /** When false, list only (no assign/revoke). Defaults to true for repo settings call sites. */
  canManage?: boolean
  /**
   * When set (repo settings History nav), hide the inline history toggle —
   * history lives on that route instead.
   */
  historyTo?: string
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
        renderBody={(v) => <ApproverVersionSeats approvers={v.approvers} />}
      />
    </div>
  )
}

function CollaboratorApproverPicker({
  collaborators,
  value,
  disabled,
  onChange,
}: {
  collaborators: Extract<CollaboratorPrincipal, { kind: 'user' }>[]
  value: ApproverPrincipal | null
  disabled?: boolean
  onChange: (next: ApproverPrincipal | null) => void
}) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const authors = useMemo(
    () => collaborators.map((c) => `${c.iss}|${c.sub}`),
    [collaborators],
  )
  const profiles = usePrincipalProfiles(authors)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return collaborators
    return collaborators.filter((c) => {
      const key = `${c.iss}|${c.sub}`
      const label = decideUserRefLabel({
        author: key,
        name: profiles.names[key],
        email: profiles.emails[key],
      }).toLowerCase()
      return (
        label.includes(q) ||
        c.sub.toLowerCase().includes(q) ||
        c.iss.toLowerCase().includes(q)
      )
    })
  }, [collaborators, profiles, query])

  const selectedKey = value ? `${value.iss}|${value.sub}` : ''
  const showList = open && collaborators.length > 0

  return (
    <div
      className="directory-picker directory-picker--dropdown"
      ref={wrapRef}
      data-testid="collaborator-approver-picker"
    >
      <label className="directory-picker-search">
        Search collaborators
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          value={
            value && !query
              ? decideUserRefLabel({
                  author: selectedKey,
                  name: profiles.names[selectedKey],
                  email: profiles.emails[selectedKey],
                })
              : query
          }
          disabled={disabled}
          placeholder="Name, email, or username"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (value) onChange(null)
          }}
          onFocus={() => {
            if (value) setQuery('')
            setOpen(true)
          }}
        />
      </label>
      {value ? (
        <p className="muted small directory-picker-selected">
          Selected: <UserRef author={selectedKey} profiles={profiles} interactive={false} />
        </p>
      ) : null}
      {collaborators.length === 0 ? (
        <p className="muted small">Add a user collaborator before assigning an approver.</p>
      ) : null}
      {showList ? (
        <ul id={listId} className="directory-picker-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="muted small directory-picker-empty">No matching collaborators.</li>
          ) : (
            filtered.map((c) => {
              const key = `${c.iss}|${c.sub}`
              const selected = key === selectedKey
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="directory-picker-option"
                    disabled={disabled}
                    onClick={() => {
                      onChange({ sub: c.sub, iss: c.iss })
                      setQuery('')
                      setOpen(false)
                    }}
                  >
                    <UserRef author={key} profiles={profiles} interactive={false} />
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Owner-managed approver seats (GxP #86). Approvers are an explicit grant, never implied by Owner,
 * maintain or admin; they may sign merges into validated branches and revoke signatures.
 */
export function ApproversSection({
  namespace,
  repo,
  canManage = true,
  historyTo,
}: Props) {
  const scope: ApproverScope = repo ? { ns: namespace, repo } : { ns: namespace }
  const label = repo ? `${namespace}/${repo}` : namespace
  const headingId = useId()
  const state = useAsync((signal) => fetchApprovers(scope, signal), [namespace, repo])
  const collabState = useAsync(
    (signal) =>
      canManage && repo
        ? fetchRepoCollaborators(namespace, repo, signal)
        : Promise.resolve(null),
    [namespace, repo, canManage],
  )
  const [picked, setPicked] = useState<ApproverPrincipal | null>(null)
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState('mice-dev')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)

  const userCollaborators = useMemo(
    () =>
      (collabState.kind === 'ok' ? collabState.data?.collaborators ?? [] : []).filter(
        (c): c is Extract<CollaboratorPrincipal, { kind: 'user' }> => c.kind === 'user',
      ),
    [collabState],
  )

  useEffect(() => {
    setPicked(null)
    setSub('')
    setIss('mice-dev')
  }, [namespace, repo])

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
      if (isCeremonyCancelled(err)) return
      setError(err instanceof Error ? err.message : 'Approver change failed')
    } finally {
      setBusy(false)
    }
  }

  function onGrant(e: FormEvent) {
    e.preventDefault()
    const target = repo
      ? picked
      : { sub: sub.trim(), iss: iss.trim() }
    if (!target?.sub || !target.iss) {
      setError(
        repo
          ? 'Choose a collaborator to assign as approver'
          : 'Choose a user from directory search',
      )
      return
    }
    void change(async () => {
      await grantApproverSeat(scope, target)
      setPicked(null)
      setSub('')
    }, `Assigned approver role to ${target.sub}`)
  }

  function onRevoke(a: ApproverPrincipal) {
    void change(() => revokeApproverSeat(scope, a), `Removed approver role from ${a.sub}`)
  }

  const approvers = state.kind === 'ok' ? state.data.approvers : []
  const inlineHistory = canManage && !historyTo

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
            {repo ? '' : ' across this namespace'}. Explicit grant — not implied
            by Owner or admin
            {!canManage ? ' (view only for you)' : ''}.
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
              {canManage ? (
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
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
      <form className="ns-member-form" onSubmit={onGrant} aria-label="Assign approver">
        <h3 className="ns-settings-subhead">Assign approver</h3>
        <div className={`ns-member-form-fields ${repo ? '' : 'cols-2'}`}>
          {repo ? (
            <CollaboratorApproverPicker
              collaborators={userCollaborators}
              value={picked}
              disabled={busy || collabState.kind === 'loading'}
              onChange={setPicked}
            />
          ) : (
            <DirectoryPicker
              kind="user"
              sub={sub}
              iss={iss}
              defaultIss="mice-dev"
              disabled={busy}
              onChange={({ sub: nextSub, iss: nextIss }) => {
                setSub(nextSub)
                setIss(nextIss)
              }}
            />
          )}
        </div>
        <div className="ns-member-form-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />
            Assign approver
          </button>
          {inlineHistory ? (
            <button
              className="btn ghost"
              type="button"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            >
              <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />
              {showHistory ? 'Hide approver history' : 'Approver history'}
            </button>
          ) : null}
        </div>
      </form>
      ) : null}

      {inlineHistory && showHistory ? <ApproverHistory key={historyKey} scope={scope} /> : null}
    </section>
  )
}
