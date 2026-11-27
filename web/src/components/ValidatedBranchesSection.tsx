import { ShieldCheck as ActionShieldCheck, Trash2 as ActionTrash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { DispositionTable } from './DispositionTable'
import { SuggestField } from './SuggestField'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe } from '../lib/auth'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import {
  coerceDispositionForSigner,
  defaultDispositionMap,
  listUnsetTipCommits,
  type DispositionCommitRow,
  type DispositionMap,
} from '../lib/disposition'
import { listBranches } from '../lib/oxen/api'
import {
  fetchValidatedBranches,
  markBranchValidated,
  unmarkBranchValidated,
} from '../lib/validatedBranches'

type Props = {
  namespace: string
  repo: string
  /** Namespace Owner or repo maintain/admin may mark/invalidate; others read-only. */
  canManage?: boolean
  /** Approver is also required when marking a tip that still has Unset commits. */
  isApprover?: boolean
}

/**
 * Repository settings: validated-branch registry.
 * Direct tip writes are refused on validated branches; content arrives via signed merge.
 * Marking requires an explicit disposition map for still-Unset tip commits (ADR 0009).
 * Zero validated branches is allowed after signed unmark or bare create (`branches: []`).
 */
export function ValidatedBranchesSection({
  namespace,
  repo,
  canManage = false,
  isApprover = false,
}: Props) {
  const headingId = useId()
  const state = useAsync(
    (signal) => fetchValidatedBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const branchesState = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const me = useAsync((signal) => fetchAuthMe(signal), [])
  const signer =
    me.kind === 'ok' && me.data.authenticated ? me.data.user : null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [unsetRows, setUnsetRows] = useState<DispositionCommitRow[]>([])
  const [disposition, setDisposition] = useState<DispositionMap>({})
  const [loadingUnset, setLoadingUnset] = useState(false)

  const validated = state.kind === 'ok' ? state.data.validatedBranches : []
  const defaultBranch = state.kind === 'ok' ? state.data.defaultBranch : 'main'
  const oxenNames =
    branchesState.kind === 'ok'
      ? branchesState.data.branches.map((b) => b.name).filter(Boolean)
      : []
  const candidates = useMemo(
    () => oxenNames.filter((name) => !validated.includes(name)).sort((a, b) => a.localeCompare(b)),
    [oxenNames, validated],
  )
  const pickOptions = useMemo(
    () => candidates.map((name) => ({ value: name, label: name })),
    [candidates],
  )

  useEffect(() => {
    const branch = pick.trim()
    if (!branch || !canManage) {
      setUnsetRows([])
      setDisposition({})
      return
    }
    let cancelled = false
    setLoadingUnset(true)
    void listUnsetTipCommits(namespace, repo, branch)
      .then((rows) => {
        if (cancelled) return
        setUnsetRows(rows)
        setDisposition(defaultDispositionMap(rows.map((r) => r.id)))
      })
      .catch(() => {
        if (cancelled) return
        setUnsetRows([])
        setDisposition({})
      })
      .finally(() => {
        if (!cancelled) setLoadingUnset(false)
      })
    return () => {
      cancelled = true
    }
  }, [namespace, repo, pick, canManage])

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
      setError(err instanceof Error ? err.message : 'Validated branch change failed')
      throw err
    } finally {
      setBusy(false)
    }
  }

  function onMark(e: FormEvent) {
    e.preventDefault()
    const branch = pick.trim()
    if (!branch) return
    const map =
      Object.keys(disposition).length > 0
        ? coerceDispositionForSigner(disposition, unsetRows, signer)
        : undefined
    void change(
      () =>
        markBranchValidated(namespace, repo, branch, {
          disposition: map,
        }),
      `“${branch}” is now validated`,
    )
      .then(() => {
        setPick('')
        setUnsetRows([])
        setDisposition({})
      })
      .catch(() => {})
  }

  function onInvalidate(branch: string) {
    const last = validated.length === 1 && validated[0] === branch
    const detail = last
      ? `“${branch}” is the only validated branch. After this, tip writes are allowed on every branch until another is marked. Continue?`
      : `Invalidate “${branch}”? Direct tip writes will be allowed again on that branch.`
    if (!window.confirm(detail)) return
    void change(
      () => unmarkBranchValidated(namespace, repo, branch),
      `Invalidated “${branch}”`,
    ).catch(() => {})
  }

  return (
    <section
      className="settings-section"
      id="repo-validated-branches"
      aria-labelledby={headingId}
      data-testid="validated-branches-section"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id={headingId}>
            <ActionShieldCheck size={18} aria-hidden="true" className="button-label-icon" />
            Validated branches
          </h2>
          <p className="muted small">
            Tip writes are refused; content arrives only via signed merge. Marking signs a
            disposition map for any still-Unset tip commits.
            {!canManage
              ? ' Only a namespace Owner or repository manager can mark or invalidate validated branches.'
              : null}
            {canManage && !isApprover
              ? ' Marking a tip with Unset history also requires Approver.'
              : null}
          </p>
        </div>
        <p className="muted small ns-settings-count">
          {validated.length} validated
        </p>
      </div>

      {state.kind === 'loading' ? (
        <p className="muted small" role="status" aria-live="polite">
          Loading validated branches…
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

      {state.kind === 'ok' && validated.length === 0 ? (
        <p className="muted small" data-testid="validated-branches-empty">
          No validated branches. Direct tip writes are allowed on every branch.
        </p>
      ) : null}

      {validated.length > 0 ? (
        <ul className="ns-member-list" data-testid="validated-branches-list">
          {validated.map((branch) => (
            <li key={branch} className="ns-member-row" data-testid="validated-branch-row">
              <div className="validated-branch-row-main">
                <code>{branch}</code>
                {branch === defaultBranch ? (
                  <span className="pill default-branch">default</span>
                ) : null}
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => onInvalidate(branch)}
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />
                  Invalidate
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <form
          className="inline-form settings-inline-form validated-branches-mark-form"
          onSubmit={onMark}
        >
          <SuggestField
            id={`${headingId}-pick`}
            name="validated-branch-pick"
            label="Branch to mark validated"
            hideLabel
            value={pick}
            onChange={setPick}
            options={pickOptions}
            placeholder="Search branches…"
            disabled={busy}
            data-testid="validated-branch-pick"
          />
          <button
            className="btn ghost"
            type="submit"
            disabled={busy || !pick.trim() || loadingUnset}
            data-testid="validated-branch-mark"
          >
            Validated
          </button>
        </form>
      ) : null}

      {canManage && pick.trim() && loadingUnset ? (
        <p className="muted small" role="status">
          Checking Unset tip commits…
        </p>
      ) : null}

      {canManage && unsetRows.length > 0 ? (
        <DispositionTable
          rows={unsetRows}
          value={disposition}
          onChange={setDisposition}
          signer={signer}
          disabled={busy}
          heading="Unset tip commits"
        />
      ) : null}

      {notice ? (
        <p className="flash flash-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
