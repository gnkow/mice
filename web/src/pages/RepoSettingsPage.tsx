import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DirectoryPicker } from '../components/DirectoryPicker'
import {
  deleteRepository,
  renameRepository,
  transferRepository,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { OxenApiError } from '../lib/oxen/types'
import {
  deleteRepoCollaborator,
  fetchCustomRoles,
  fetchRepoCollaborators,
  putRepoCollaborator,
  type CollaboratorPrincipal,
  type CollaboratorRoleRef,
} from '../lib/authzApi'

export function RepoSettingsPage() {
  const { namespace = '', repo = '' } = useParams()
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [targetNs, setTargetNs] = useState('')
  const [collaborators, setCollaborators] = useState<CollaboratorPrincipal[]>(
    [],
  )
  const [collabKind, setCollabKind] = useState<'user' | 'group'>('user')
  const [collabSub, setCollabSub] = useState('')
  const [collabIss, setCollabIss] = useState('boxen-dev')
  const [collabGroup, setCollabGroup] = useState('')
  const [collabRole, setCollabRole] = useState<CollaboratorRoleRef>('read')
  const [customRepoRoles, setCustomRepoRoles] = useState<
    Array<{ id: string; name: string }>
  >([])

  useEffect(() => {
    let cancelled = false
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
    return () => {
      cancelled = true
    }
  }, [namespace, repo])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
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
    void run(async () => {
      await renameRepository(namespace, repo, newName.trim())
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(newName.trim())}/tree/main`,
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
      <h2 className="section-label">Settings</h2>
      <p className="muted">
        Repository admin for <code>{namespace}/{repo}</code>
      </p>

      <section className="panel">
        <h3 className="section-label">Rename</h3>
        <p className="muted small">
          Rename is not supported on name-addressed self-hosted oxen-server
          (Hub / UUID only).
        </p>
        <form className="inline-form" onSubmit={onRename}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New name"
            required
          />
          <button className="btn ghost" type="submit" disabled={busy}>
            Rename
          </button>
        </form>
      </section>

      <section className="panel">
        <h3 className="section-label">Transfer</h3>
        <p className="muted small">Move this repository to another namespace.</p>
        <form className="inline-form" onSubmit={onTransfer}>
          <input
            value={targetNs}
            onChange={(e) => setTargetNs(e.target.value)}
            placeholder="Target namespace"
            required
          />
          <button className="btn ghost" type="submit" disabled={busy}>
            Transfer
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="ns-settings-section-head">
          <div>
            <h3 className="section-label">Collaborators</h3>
            <p className="muted small">
              Direct repository access for users or groups (including outside
              collaborators without namespace membership).
            </p>
          </div>
          <p className="muted small ns-settings-count">
            {collaborators.length} collaborator
            {collaborators.length === 1 ? '' : 's'}
          </p>
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
                      <>
                        <code className="ns-member-sub">{c.group}</code>
                        <span className="muted small">Group</span>
                      </>
                    ) : (
                      <>
                        <code className="ns-member-sub">{c.sub}</code>
                        <span className="muted small">{c.iss}</span>
                      </>
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
                    Remove
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
                  role: collabRole,
                })
                setCollabGroup('')
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
                disabled={busy}
                onChange={({ group }) => setCollabGroup(group)}
              />
            ) : (
              <DirectoryPicker
                kind="user"
                sub={collabSub}
                iss={collabIss}
                defaultIss="boxen-dev"
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
                Add collaborator
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="panel danger-zone">
        <h3 className="section-label">Danger zone</h3>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          Delete repository
        </button>
      </section>

      {actionError && <p className="error">{actionError}</p>}
    </main>
  )
}
