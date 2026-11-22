import { History as ActionHistory, MoveRight as ActionMoveRight, Pencil as ActionPencil, Trash2 as ActionTrash2, UserPlus as ActionUserPlus } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ApproversSection } from '../components/ApproversSection'
import { usePrincipalProfiles } from '../components/CommitEmail'
import type { RepoSettingsOutletContext } from '../components/RepoSettingsLayout'
import { SignedRecordReportButton } from '../components/SignedRecordReportButton'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { GroupPrincipalLabel } from '../components/GroupPrincipalLabel'
import { UserRef } from '../components/UserRef'
import { deleteRepository, transferRepository } from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { OxenApiError } from '../lib/oxen/types'
import {
  AuthzError,
  deleteRepoCollaborator,
  fetchCustomRoles,
  fetchRepoCollaborators,
  putRepoCollaborator,
  renameRepoAuthz,
  type CollaboratorPrincipal,
  type CollaboratorRoleRef,
} from '../lib/authzApi'
import {
  SIGNED_MUTATION_COMPLETE_EVENT,
  type PendingSignedMutation,
} from '../lib/signingResume'

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
    const name =
      intent.body &&
      typeof intent.body === 'object' &&
      'name' in intent.body &&
      typeof (intent.body as { name: unknown }).name === 'string'
        ? (intent.body as { name: string }).name.trim()
        : ''
    if (!name || name === repo) return false
    navigate(
      `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(name)}/tree/main`,
    )
    return true
  }

  if (method === 'PATCH' && apiPath === `${oxenRepo}/transfer`) {
    const targetNs =
      intent.body &&
      typeof intent.body === 'object' &&
      'namespace' in intent.body &&
      typeof (intent.body as { namespace: unknown }).namespace === 'string'
        ? (intent.body as { namespace: string }).namespace.trim()
        : ''
    if (!targetNs) return false
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

export function RepoSettingsPage() {
  const { namespace = '', repo = '' } = useParams()
  const navigate = useNavigate()
  const { permissions: perms } = useOutletContext<RepoSettingsOutletContext>()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState(repo)
  const [targetNs, setTargetNs] = useState('')
  const [collaborators, setCollaborators] = useState<CollaboratorPrincipal[]>(
    [],
  )
  const [collabKind, setCollabKind] = useState<'user' | 'group'>('user')
  const [collabSub, setCollabSub] = useState('')
  const [collabIss, setCollabIss] = useState('mice-dev')
  const [collabGroup, setCollabGroup] = useState('')
  const [collabGroupName, setCollabGroupName] = useState('')
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

  useEffect(() => {
    function onComplete(e: Event) {
      const intent = (e as CustomEvent<PendingSignedMutation>).detail
      if (!intent) return
      navigateAfterRepoMutation(intent, namespace, repo, navigate)
    }
    window.addEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    return () => window.removeEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
  }, [namespace, repo, navigate])

  useEffect(() => {
    let cancelled = false
    if (perms.manageCollaborators) {
      fetchRepoCollaborators(namespace, repo)
        .then((data) => {
          if (!cancelled) setCollaborators(data.collaborators)
        })
        .catch(() => {
          if (!cancelled) setCollaborators([])
        })
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
      setCollaborators([])
      setCustomRepoRoles([])
    }
    return () => {
      cancelled = true
    }
  }, [namespace, repo, perms.manageCollaborators])

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
    void run(async () => {
      const res = await transferRepository(namespace, repo, targetNs.trim())
      navigate(
        `/n/${encodeURIComponent(res.repository.namespace)}/r/${encodeURIComponent(res.repository.name)}/tree/main`,
      )
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
              />
              <button
                className="btn ghost"
                type="submit"
                disabled={busy || !newName.trim() || newName.trim() === repo}
              >
                <ActionPencil size={14} aria-hidden="true" className="button-label-icon" />Rename
              </button>
            </form>
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
              Move this repository to another namespace.
            </p>
            <form
              className="inline-form settings-inline-form"
              onSubmit={onTransfer}
            >
              <input
                value={targetNs}
                onChange={(e) => setTargetNs(e.target.value)}
                placeholder="Target namespace"
                required
              />
              <button className="btn ghost" type="submit" disabled={busy}>
                <ActionMoveRight size={14} aria-hidden="true" className="button-label-icon" />Transfer
              </button>
            </form>
          </section>
        ) : null}

        {perms.manageCollaborators ? (
          <section
            className="settings-section"
            id="repo-collaborators"
            aria-labelledby="repo-collab-heading"
          >
            <div className="ns-settings-section-head">
              <div>
                <h2 id="repo-collab-heading">Collaborators</h2>
                <p className="muted small">
                  Direct repository access for users or groups (including outside
                  collaborators without namespace membership).
                </p>
              </div>
              <div>
                <p className="muted small ns-settings-count">
                  {collaborators.length} collaborator
                  {collaborators.length === 1 ? '' : 's'}
                </p>
                <Link
                  className="btn ghost small"
                  to={`${base}/settings/collaborators/history`}
                >
                  <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />Collaborator history
                </Link>
              </div>
            </div>

            {collaborators.length === 0 ? (
              <p className="muted small">No collaborators yet.</p>
            ) : (
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
                            setCollaborators(
                              (await fetchRepoCollaborators(namespace, repo))
                                .collaborators,
                            )
                          })
                        }}
                      >
                        <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <form
              className="ns-member-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (collabKind === 'group') {
                  if (!collabGroup.trim()) {
                    setActionError(
                      'Choose a group from search or enter one manually',
                    )
                    return
                  }
                } else if (!collabSub.trim() || !collabIss.trim()) {
                  setActionError(
                    'Choose a user from search or enter sub/iss manually',
                  )
                  return
                }
                void run(async () => {
                  if (collabKind === 'group') {
                    await putRepoCollaborator(namespace, repo, {
                      kind: 'group',
                      group: collabGroup.trim(),
                      name: collabGroupName.trim() || collabGroup.trim(),
                      role: collabRole,
                    })
                    setCollabGroup('')
                    setCollabGroupName('')
                  } else {
                    await putRepoCollaborator(namespace, repo, {
                      kind: 'user',
                      sub: collabSub.trim(),
                      iss: collabIss.trim(),
                      role: collabRole,
                    })
                    setCollabSub('')
                  }
                  setCollaborators(
                    (await fetchRepoCollaborators(namespace, repo)).collaborators,
                  )
                })
              }}
            >
              <h3 className="ns-settings-subhead">Add collaborator</h3>
              <div className="ns-member-form-fields">
                <label>
                  Identity
                  <select
                    className="ns-select"
                    value={collabKind}
                    onChange={(e) =>
                      setCollabKind(e.target.value as 'user' | 'group')
                    }
                  >
                    <option value="user">User</option>
                    <option value="group">Group</option>
                  </select>
                </label>
                {collabKind === 'group' ? (
                  <DirectoryPicker
                    kind="group"
                    group={collabGroup}
                    label={collabGroupName}
                    disabled={busy}
                    onChange={({ group, name }) => {
                      setCollabGroup(group)
                      setCollabGroupName(name)
                    }}
                  />
                ) : (
                  <DirectoryPicker
                    kind="user"
                    sub={collabSub}
                    iss={collabIss}
                    defaultIss="mice-dev"
                    disabled={busy}
                    onChange={({ sub, iss }) => {
                      setCollabSub(sub)
                      setCollabIss(iss)
                    }}
                  />
                )}
                <label>
                  Role
                  <select
                    className="ns-select"
                    value={collabRole}
                    onChange={(e) =>
                      setCollabRole(e.target.value as CollaboratorRoleRef)
                    }
                  >
                    <optgroup label="Repository roles">
                      <option value="read">Read</option>
                      <option value="triage">Triage</option>
                      <option value="write">Write</option>
                      <option value="maintain">Maintain</option>
                      <option value="admin">Admin</option>
                    </optgroup>
                    {customRepoRoles.length > 0 ? (
                      <optgroup label="Custom roles">
                        {customRepoRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
                <div className="ns-member-form-actions">
                  <button className="btn primary" type="submit" disabled={busy}>
                    <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />Add collaborator
                  </button>
                </div>
              </div>
            </form>
          </section>
        ) : null}

        {perms.viewSignedRecord ? (
          <ApproversSection
            namespace={namespace}
            repo={repo}
            canManage={perms.manageApprovers}
            historyTo={`${base}/settings/approvers/history`}
          />
        ) : null}

        {perms.viewSignedRecord ? (
          <section
            className="settings-section"
            id="repo-signed-record"
            aria-labelledby="repo-signed-record-heading"
          >
            <h2 id="repo-signed-record-heading">Signed-record report</h2>
            <p className="muted small">
              Per-repository report of electronic signatures, revocations and QC
              status for audit and release evidence. Requires read access.
            </p>
            <SignedRecordReportButton namespace={namespace} repo={repo} />
          </section>
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
