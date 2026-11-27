import { MoveRight as ActionMoveRight, Pencil as ActionPencil, Trash2 as ActionTrash2 } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ApproversSection } from '../components/ApproversSection'
import { ValidatedBranchesSection } from '../components/ValidatedBranchesSection'
import { usePrincipalProfiles } from '../components/CommitEmail'
import type { RepoSettingsOutletContext } from '../components/RepoSettingsLayout'
import { RepoSignaturesSection } from '../components/RepoSignaturesSection'
import { GroupPrincipalLabel } from '../components/GroupPrincipalLabel'
import { PrincipalAddCard } from '../components/PrincipalAddCard'
import { TransferAccessDiffView } from '../components/TransferAccessDiff'
import { UserRef } from '../components/UserRef'
import { deleteRepository } from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { OxenApiError } from '../lib/oxen/types'
import {
  AuthzError,
  cancelRepoTransfer,
  deleteRepoCollaborator,
  fetchAuthzRepository,
  fetchCustomRoles,
  fetchPendingRepoTransfer,
  fetchRepoCollaborators,
  listAuthzNamespaces,
  previewRepoTransfer,
  proposeRepoTransfer,
  putRepoCollaborator,
  renameRepoAuthz,
  updateRepoDescriptionAuthz,
  type CollaboratorPrincipal,
  type CollaboratorRoleRef,
  type TransferAccessDiff,
} from '../lib/authzApi'
import { useAsync } from '../hooks/useAsync'
import {
  SIGNED_MUTATION_COMPLETE_EVENT,
  type PendingSignedMutation,
} from '../lib/signingResume'

function bodyString(
  body: unknown,
  key: string,
): string {
  if (!body || typeof body !== 'object' || !(key in body)) return ''
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * After MFA/step-up resume, the original form await is gone — navigate from the
 * stashed mutation that `ReasonPromptProvider` completed.
 */
export function navigateAfterRepoMutation(
  intent: PendingSignedMutation,
  namespace: string,
  repo: string,
  navigate: (to: string) => void,
): boolean {
  const apiPath = intent.apiPath.split('?')[0] ?? intent.apiPath
  const method = intent.method.toUpperCase()
  const authzRepo = `/auth/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}`
  const oxenRepo = `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`

  if (method === 'PATCH' && apiPath === authzRepo) {
    const name = bodyString(intent.body, 'name')
    if (!name || name === repo) return false
    navigate(
      `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(name)}/tree/main`,
    )
    return true
  }

  if (method === 'POST' && apiPath === `${authzRepo}/transfer/accept`) {
    const targetNs = bodyString(intent.body, 'targetNamespace')
    if (!targetNs) return false
    navigate(
      `/n/${encodeURIComponent(targetNs)}/r/${encodeURIComponent(repo)}/tree/main`,
    )
    return true
  }

  if (method === 'POST' && apiPath === `${authzRepo}/transfer`) {
    const targetNs = bodyString(intent.body, 'targetNamespace')
    if (!targetNs) return false
    // One-shot lands on dest; pending stays on source settings (async resume
    // path may briefly hit dest — form await handles the common case).
    navigate(
      `/n/${encodeURIComponent(targetNs)}/r/${encodeURIComponent(repo)}/tree/main`,
    )
    return true
  }

  if (method === 'DELETE' && apiPath === oxenRepo) {
    navigate('/repositories')
    return true
  }

  return false
}

/**
 * Resume handler that distinguishes one-shot vs pending after propose.
 * Returns a promise so the page can await pending-status before navigating.
 */
export async function navigateAfterTransferPropose(
  intent: PendingSignedMutation,
  namespace: string,
  repo: string,
  navigate: (to: string) => void,
): Promise<boolean> {
  const apiPath = intent.apiPath.split('?')[0] ?? intent.apiPath
  if (
    intent.method.toUpperCase() !== 'POST' ||
    apiPath !==
      `/auth/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}/transfer`
  ) {
    return false
  }
  const targetNs = bodyString(intent.body, 'targetNamespace')
  if (!targetNs) return false
  try {
    const pending = await fetchPendingRepoTransfer(namespace, repo)
    if (pending) {
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/settings#repo-transfer`,
      )
      return true
    }
  } catch {
    /* fall through to dest navigate */
  }
  navigate(
    `/n/${encodeURIComponent(targetNs)}/r/${encodeURIComponent(repo)}/tree/main`,
  )
  return true
}

export function RepoSettingsPage() {
  const { namespace = '', repo = '' } = useParams()
  const navigate = useNavigate()
  const { permissions: perms } = useOutletContext<RepoSettingsOutletContext>()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState(repo)
  const [description, setDescription] = useState('')
  const [descriptionSaved, setDescriptionSaved] = useState(false)
  const [targetNs, setTargetNs] = useState('')
  const [transferDiff, setTransferDiff] = useState<TransferAccessDiff | null>(null)
  const [transferDiffBusy, setTransferDiffBusy] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const authzRepo = useAsync(
    (signal) => fetchAuthzRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const namespacesState = useAsync(
    (signal) => listAuthzNamespaces(signal),
    [],
  )
  const pendingTransfer = useAsync(
    (signal) => fetchPendingRepoTransfer(namespace, repo, signal),
    [namespace, repo],
  )
  const collabState = useAsync(
    (signal) => fetchRepoCollaborators(namespace, repo, signal),
    [namespace, repo],
  )
  const namespaceOptions = useMemo(() => {
    if (namespacesState.kind !== 'ok') return []
    return namespacesState.data.namespaces
      .map((n) => n.name)
      .filter((n) => n !== namespace)
      .sort((a, b) => a.localeCompare(b))
  }, [namespacesState, namespace])
  const collaborators =
    collabState.kind === 'ok' ? collabState.data.collaborators : []
  const [collabRole, setCollabRole] = useState<CollaboratorRoleRef>('read')
  const [customRepoRoles, setCustomRepoRoles] = useState<
    Array<{ id: string; name: string }>
  >([])
  const collaboratorAuthors = useMemo(
    () =>
      collaborators
        .filter((c): c is Extract<CollaboratorPrincipal, { kind: 'user' }> => c.kind === 'user')
        .map((c) => `${c.iss}|${c.sub}`),
    [collaborators],
  )
  const collaboratorProfiles = usePrincipalProfiles(collaboratorAuthors)

  useEffect(() => {
    setNewName(repo)
  }, [repo])

  const loadedDescription =
    authzRepo.kind === 'ok' ? (authzRepo.data.repository.description ?? '') : null
  useEffect(() => {
    if (loadedDescription !== null) setDescription(loadedDescription)
  }, [loadedDescription])

  useEffect(() => {
    function onComplete(e: Event) {
      const intent = (e as CustomEvent<PendingSignedMutation>).detail
      if (!intent) return
      const apiPath = intent.apiPath.split('?')[0] ?? intent.apiPath
      if (
        intent.method.toUpperCase() === 'POST' &&
        apiPath ===
          `/auth/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}/transfer`
      ) {
        void navigateAfterTransferPropose(intent, namespace, repo, navigate).then(
          (handled) => {
            if (handled) pendingTransfer.reload()
          },
        )
        return
      }
      navigateAfterRepoMutation(intent, namespace, repo, navigate)
    }
    window.addEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    return () => window.removeEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    // pendingTransfer.reload is stable enough for this page lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, repo, navigate])

  useEffect(() => {
    setTransferDiff(null)
    setCancelReason('')
  }, [targetNs, namespace, repo])

  useEffect(() => {
    const next = targetNs.trim()
    if (!next || next === namespace) {
      setTransferDiff(null)
      return
    }
    let cancelled = false
    setTransferDiffBusy(true)
    void previewRepoTransfer(namespace, repo, next)
      .then((diff) => {
        if (!cancelled) setTransferDiff(diff)
      })
      .catch(() => {
        if (!cancelled) setTransferDiff(null)
      })
      .finally(() => {
        if (!cancelled) setTransferDiffBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [namespace, repo, targetNs])

  useEffect(() => {
    let cancelled = false
    if (perms.manageCollaborators) {
      fetchCustomRoles(namespace)
        .then((data) => {
          if (!cancelled) {
            setCustomRepoRoles(
              data.repoRoles.map((r) => ({ id: r.id, name: r.name })),
            )
          }
        })
        .catch(() => {
          if (!cancelled) setCustomRepoRoles([])
        })
    } else {
      setCustomRepoRoles([])
    }
    return () => {
      cancelled = true
    }
  }, [namespace, perms.manageCollaborators])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setActionError(
        err instanceof OxenApiError || err instanceof AuthzError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Action failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onSaveDescription(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await updateRepoDescriptionAuthz(namespace, repo, description)
      authzRepo.reload()
      setDescriptionSaved(true)
      window.setTimeout(() => setDescriptionSaved(false), 1500)
    })
  }

  function onRename(e: FormEvent) {
    e.preventDefault()
    const next = newName.trim()
    if (!next || next === repo) return
    void run(async () => {
      const res = await renameRepoAuthz(namespace, repo, next)
      const name = res.name || next
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(name)}/tree/main`,
      )
    })
  }

  function onTransfer(e: FormEvent) {
    e.preventDefault()
    const dest = targetNs.trim()
    if (!dest || dest === namespace) return
    void run(async () => {
      const res = await proposeRepoTransfer(namespace, repo, dest)
      if (res.mode === 'one-shot') {
        navigate(
          `/n/${encodeURIComponent(res.repository.namespace)}/r/${encodeURIComponent(res.repository.name)}/tree/main`,
        )
        return
      }
      setTargetNs('')
      setTransferDiff(null)
      pendingTransfer.reload()
    })
  }

  function onCancelTransfer() {
    const reason = cancelReason.trim()
    if (reason.length < 10) {
      setActionError('Cancel reason must be at least 10 characters')
      return
    }
    void run(async () => {
      await cancelRepoTransfer(namespace, repo, reason)
      setCancelReason('')
      pendingTransfer.reload()
    })
  }

  async function onDelete() {
    if (
      !(await confirmDelete({
        title: `Delete repository ${namespace}/${repo}`,
        detail:
          'The entire repository and all of its history will be permanently removed from the server.',
        confirmWord: repo,
      }))
    ) {
      return
    }
    void run(async () => {
      await deleteRepository(namespace, repo)
      navigate('/repositories')
    })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="crumb">
            <Link to={base}>{repo}</Link>
            <span aria-hidden> / </span>
            <span>Settings</span>
          </p>
          <h1>Settings</h1>
          <p className="lede">
            Repository admin for <code>{namespace}/{repo}</code>.
          </p>
        </div>
      </div>

      {actionError && <p className="flash flash-error" role="status">{actionError}</p>}

      <div className="repo-settings">
        {perms.rename ? (
          <section
            className="settings-section"
            id="repo-about"
            aria-labelledby="repo-about-heading"
          >
            <h2 id="repo-about-heading">About</h2>
            <p className="muted small">
              Short description shown in the repository sidebar.
            </p>
            <form className="form" onSubmit={onSaveDescription}>
              <label>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What is this repository for?"
                  disabled={busy || authzRepo.kind === 'loading'}
                />
              </label>
              <div className="btn-row">
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || authzRepo.kind === 'loading'}
                >
                  Save description
                </button>
                {authzRepo.kind === 'error' ? (
                  <p className="flash flash-error" role="status">
                    {authzRepo.message}
                  </p>
                ) : null}
                {descriptionSaved ? (
                  <p className="flash flash-success" role="status">
                    Saved.
                  </p>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}

        {perms.rename ? (
          <section
            className="settings-section"
            id="repo-rename"
            aria-labelledby="repo-rename-heading"
          >
            <h2 id="repo-rename-heading">Rename</h2>
            <p className="muted small">
              Changes the display name only. The stable repository id (and oxen
              path) stay the same.
            </p>
            <form className="inline-form settings-inline-form" onSubmit={onRename}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New name"
                autoComplete="off"
                required
                aria-invalid={newName.trim() === repo}
                aria-describedby={
                  newName.trim() === repo ? 'repo-rename-same-name' : undefined
                }
              />
              <button
                className="btn ghost"
                type="submit"
                disabled={busy || !newName.trim() || newName.trim() === repo}
                title={
                  newName.trim() === repo
                    ? 'Choose a different name to rename'
                    : undefined
                }
              >
                <ActionPencil size={14} aria-hidden="true" className="button-label-icon" />Rename
              </button>
            </form>
            {newName.trim() === repo ? (
              <p id="repo-rename-same-name" className="muted small">
                Already the current name — enter a different display name to rename.
              </p>
            ) : null}
          </section>
        ) : null}

        {perms.transfer ? (
          <section
            className="settings-section"
            id="repo-transfer"
            aria-labelledby="repo-transfer-heading"
          >
            <h2 id="repo-transfer-heading">Transfer</h2>
            <p className="muted small">
              Move this repository to another existing namespace (source namespace
              Owner). If you also own the destination, the transfer completes
              immediately; otherwise it stays pending until a destination Owner
              accepts it from namespace settings.
            </p>

            {pendingTransfer.kind === 'ok' && pendingTransfer.data ? (
              <div className="flash flash-warn" role="status">
                <p>
                  Pending transfer to{' '}
                  <code>{pendingTransfer.data.targetNamespace}</code>
                  {' · '}proposed{' '}
                  {new Date(pendingTransfer.data.createdAt).toLocaleString()}
                  {pendingTransfer.data.expiresAt
                    ? ` · expires ${new Date(pendingTransfer.data.expiresAt).toLocaleString()}`
                    : null}
                </p>
                <label className="ns-settings-field">
                  <span className="ns-settings-label">Cancel reason</span>
                  <input
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="At least 10 characters"
                    disabled={busy}
                    minLength={10}
                  />
                </label>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || cancelReason.trim().length < 10}
                    onClick={() => onCancelTransfer()}
                  >
                    Cancel transfer
                  </button>
                </div>
              </div>
            ) : (
              <form className="form repo-transfer-form" onSubmit={onTransfer}>
                <label className="ns-settings-field">
                  <span className="ns-settings-label">Target namespace</span>
                  <select
                    value={targetNs}
                    onChange={(e) => setTargetNs(e.target.value)}
                    required
                    disabled={busy || namespacesState.kind === 'loading'}
                    aria-label="Target namespace"
                  >
                    <option value="">Select a namespace…</option>
                    {namespaceOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                {namespacesState.kind === 'error' ? (
                  <p className="flash flash-error" role="status">
                    {namespacesState.message}
                  </p>
                ) : null}
                <TransferAccessDiffView
                  diff={transferDiff}
                  loading={transferDiffBusy}
                />
                <div className="btn-row repo-transfer-actions">
                  <button
                    className="btn ghost"
                    type="submit"
                    disabled={
                      busy ||
                      !targetNs.trim() ||
                      targetNs.trim() === namespace ||
                      transferDiffBusy
                    }
                  >
                    <ActionMoveRight
                      size={14}
                      aria-hidden="true"
                      className="button-label-icon"
                    />
                    Transfer
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : null}

        <section
          className="settings-section"
          id="repo-collaborators"
          aria-labelledby="repo-collab-heading"
        >
          <div className="ns-settings-section-head">
            <div>
              <h2 id="repo-collab-heading">Collaborators</h2>
              <p className="muted small">
                Who can read, write, and merge. Managed by Owners and
                maintain/admin seats
                {!perms.manageCollaborators ? ' (view only for you)' : null}.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {collaborators.length} collaborator
              {collaborators.length === 1 ? '' : 's'}
            </p>
          </div>

          {collabState.kind === 'loading' ? (
            <p className="muted small" role="status" aria-live="polite">
              Loading collaborators…
            </p>
          ) : null}
          {collabState.kind === 'error' ? (
            <div className="flash flash-error" role="alert">
              <p>{collabState.message}</p>
              <button
                type="button"
                className="btn ghost"
                onClick={() => collabState.reload()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {collabState.kind === 'ok' && collaborators.length === 0 ? (
            <p className="muted small">No collaborators yet.</p>
          ) : null}
          {collaborators.length > 0 ? (
            <ul className="ns-member-list">
              {collaborators.map((c) => {
                const roleLabel =
                  customRepoRoles.find((r) => r.id === c.role)?.name ?? c.role
                return (
                  <li
                    key={
                      c.kind === 'group'
                        ? `group:${c.group}`
                        : `${c.iss}:${c.sub}`
                    }
                    className="ns-member-row"
                  >
                    <div className="ns-member-main">
                      {c.kind === 'group' ? (
                        <GroupPrincipalLabel group={c.group} name={c.name} />
                      ) : (
                        <UserRef
                          author={`${c.iss}|${c.sub}`}
                          profiles={collaboratorProfiles}
                        />
                      )}
                    </div>
                    <span className="ns-tag">{roleLabel}</span>
                    {perms.manageCollaborators ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await deleteRepoCollaborator(
                              namespace,
                              repo,
                              c.kind === 'group'
                                ? { kind: 'group', group: c.group }
                                : { kind: 'user', sub: c.sub, iss: c.iss },
                            )
                            collabState.reload()
                          })
                        }}
                      >
                        <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}

          {perms.manageCollaborators ? (
            <div className="ns-member-form">
              <h3 className="ns-settings-subhead">Add collaborator</h3>
              <PrincipalAddCard
                disabled={busy}
                role={collabRole}
                onRoleChange={(r) =>
                  setCollabRole(r as CollaboratorRoleRef)
                }
                addLabel="Add collaborator"
                roles={[
                  {
                    label: 'Repository roles',
                    options: [
                      { value: 'read', label: 'Read' },
                      { value: 'triage', label: 'Triage' },
                      { value: 'write', label: 'Write' },
                      { value: 'maintain', label: 'Maintain' },
                      { value: 'admin', label: 'Admin' },
                    ],
                  },
                  ...(customRepoRoles.length > 0
                    ? [
                        {
                          label: 'Custom roles',
                          options: customRepoRoles.map((r) => ({
                            value: r.id,
                            label: r.name,
                          })),
                        },
                      ]
                    : []),
                ]}
                onAdd={async (principal) => {
                  setBusy(true)
                  setActionError(null)
                  try {
                    if (principal.kind === 'group') {
                      await putRepoCollaborator(namespace, repo, {
                        kind: 'group',
                        group: principal.group,
                        name: principal.name,
                        role: collabRole,
                      })
                    } else {
                      await putRepoCollaborator(namespace, repo, {
                        kind: 'user',
                        sub: principal.sub,
                        iss: principal.iss,
                        role: collabRole,
                      })
                    }
                    collabState.reload()
                  } catch (err) {
                    if (!isCeremonyCancelled(err)) {
                      setActionError(
                        err instanceof OxenApiError || err instanceof AuthzError
                          ? err.message
                          : err instanceof Error
                            ? err.message
                            : 'Action failed',
                      )
                    }
                    throw err
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </div>
          ) : null}
        </section>

        <ApproversSection
          namespace={namespace}
          repo={repo}
          canManage={perms.manageApprovers}
        />

        <ValidatedBranchesSection
          namespace={namespace}
          repo={repo}
          canManage={perms.manageCollaborators}
          isApprover={perms.isApprover === true}
        />

        {perms.viewSignedRecord ? (
          <RepoSignaturesSection
            namespace={namespace}
            repo={repo}
            canRevoke={perms.isApprover === true}
          />
        ) : null}

        {perms.viewSignedRecord ? (
          <section
            className="settings-section"
            id="repo-metadata"
            aria-labelledby="repo-meta-heading"
          >
            <h2 id="repo-meta-heading">Metadata</h2>
            {!perms.editMetadata ? (
              <p className="muted small">
                You can view metadata for this repository. Editing requires write access.
              </p>
            ) : null}
            <MetaBody type="repo" id={`${namespace}/${repo}`} />
          </section>
        ) : null}

        {perms.deleteRepository ? (
          <section
            className="danger-zone ns-danger-zone"
            id="repo-danger"
            aria-labelledby="repo-danger-heading"
          >
            <div className="ns-danger-copy">
              <h2 id="repo-danger-heading">Danger zone</h2>
              <p className="muted small">
                Permanently delete this repository and all of its history from the
                server. This cannot be undone.
              </p>
            </div>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Delete repository
            </button>
          </section>
        ) : null}
      </div>
    </main>
  )
}
