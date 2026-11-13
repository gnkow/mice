import {
  Pencil as ActionPencil,
  Save as ActionSave,
  Trash2 as ActionTrash2,
  UserPlus as ActionUserPlus,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { CustomRolesSection } from '../components/CustomRolesSection'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import {
  deleteNamespaceAuthz,
  deleteNamespaceMember,
  fetchCustomRoles,
  fetchNamespaceAuthz,
  patchNamespaceAuthz,
  putNamespaceMember,
  type BasePermission,
  type MemberPrincipal,
  type MemberRoleRef,
} from '../lib/authzApi'

const BASE_OPTS: BasePermission[] = [
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]

const BASE_HELP: Record<BasePermission, string> = {
  none: 'Members need an explicit repo role to see repositories.',
  read: 'Members can browse and pull every repository in the namespace.',
  triage: 'Members can manage issues/PRs but not push by default.',
  write: 'Members can push to repositories they can access.',
  maintain: 'Members can manage most repo settings without full admin.',
  admin: 'Members have admin on every repository (use sparingly).',
}

const NS_NAME_RE = /^[a-zA-Z0-9._-]+$/

type ChromeOutlet = { reloadChrome?: () => void }

/** Settings tab under `/n/:namespace/settings` (chrome + left nav from layouts). */
export function NamespaceSettingsPage() {
  const { namespace = '' } = useParams()
  const navigate = useNavigate()
  const outlet = useOutletContext<ChromeOutlet | null>()
  const state = useAsync(
    (signal) => fetchNamespaceAuthz(namespace, signal),
    [namespace],
  )
  const customRoles = useAsync(
    (signal) => fetchCustomRoles(namespace, signal).catch(() => null),
    [namespace],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [description, setDescription] = useState('')
  const [savedDescription, setSavedDescription] = useState('')
  const [newName, setNewName] = useState(namespace)
  const [principalKind, setPrincipalKind] = useState<'user' | 'group'>('user')
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState('mice-dev')
  const [group, setGroup] = useState('')
  const [groupName, setGroupName] = useState('')
  const [role, setRole] = useState<MemberRoleRef>('member')

  const serverDescription =
    state.kind === 'ok' ? (state.data.description ?? '') : null

  useEffect(() => {
    setNewName(namespace)
  }, [namespace])

  useEffect(() => {
    if (serverDescription === null) return
    setDescription(serverDescription)
    setSavedDescription(serverDescription)
  }, [serverDescription])

  useEffect(() => {
    if (state.kind !== 'ok') return
    const id = window.location.hash.replace(/^#/, '')
    if (!id) return
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [state.kind])

  const descriptionDirty = description.trim() !== savedDescription.trim()

  async function saveSettings(patch: {
    description?: string
    basePermission?: BasePermission
    membersCanCreateRepos?: boolean
  }) {
    setBusy(true)
    setError(null)
    try {
      await patchNamespaceAuthz(namespace, patch)
      if (patch.description !== undefined) {
        setSavedDescription(patch.description)
        outlet?.reloadChrome?.()
      }
      await state.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveDescription(e: FormEvent) {
    e.preventDefault()
    if (!descriptionDirty) return
    await saveSettings({ description: description.trim() })
  }

  async function onRename(e: FormEvent) {
    e.preventDefault()
    const next = newName.trim()
    if (!next || next === namespace) return
    if (!NS_NAME_RE.test(next)) {
      setError('Invalid namespace name (letters, digits, ., _, - only)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await patchNamespaceAuthz(namespace, { name: next })
      const renamed = res.name ?? res.namespace?.name ?? next
      navigate(`/n/${encodeURIComponent(renamed)}/settings`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
      setBusy(false)
    }
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault()
    if (principalKind === 'group') {
      if (!group.trim()) {
        setError('Choose a group from search or enter one manually')
        return
      }
    } else if (!sub.trim() || !iss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (principalKind === 'group') {
        await putNamespaceMember(namespace, {
          kind: 'group',
          group: group.trim(),
          name: groupName.trim() || group.trim(),
          role,
        })
        setGroup('')
        setGroupName('')
      } else {
        await putNamespaceMember(namespace, {
          kind: 'user',
          sub: sub.trim(),
          iss: iss.trim(),
          role,
        })
        setSub('')
      }
      await state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveMember(m: MemberPrincipal) {
    setBusy(true)
    setError(null)
    try {
      await deleteNamespaceMember(
        namespace,
        m.kind === 'group'
          ? { kind: 'group', group: m.group }
          : { kind: 'user', sub: m.sub, iss: m.iss },
      )
      await state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteNamespace() {
    if (
      !(await confirmDelete({
        title: `Delete namespace ${namespace}`,
        detail:
          'All repositories in this namespace will be deleted from oxen-server, and AuthZ membership will be removed.',
        confirmWord: namespace,
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteNamespaceAuthz(namespace, { deleteRepositories: true })
      navigate('/namespaces')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && (
        <p className="flash flash-error" role="status">
          {error}
        </p>
      )}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' && (
          <div className="ns-settings">
            <section
              id="ns-general"
              className="settings-section"
              aria-labelledby="ns-general-heading"
            >
              <div className="ns-settings-section-head">
                <div>
                  <h2 id="ns-general-heading">General</h2>
                  <p className="muted small">
                    Namespace identity and base permissions for every Member on
                    repositories in this namespace (GitHub-style org base role).
                    Suggested default: <code>none</code>.
                  </p>
                </div>
              </div>

              <form className="ns-settings-grid" onSubmit={(e) => void saveDescription(e)}>
                <label className="ns-settings-field ns-settings-field-wide">
                  <span className="ns-settings-label">Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="What this namespace is for"
                    disabled={busy}
                  />
                  <span className="muted small">
                    Shown on the namespace list and overview. Max 2000 characters.
                  </span>
                </label>
                {descriptionDirty && (
                  <div className="ns-settings-actions">
                    <button type="submit" className="btn primary" disabled={busy}>
                      <ActionSave size={14} aria-hidden="true" className="button-label-icon" />
                      Save description
                    </button>
                  </div>
                )}
              </form>

              <div className="ns-settings-grid">
                <label className="ns-settings-field">
                  <span className="ns-settings-label">Base permission</span>
                  <select
                    value={state.data.basePermission}
                    disabled={busy}
                    onChange={(e) =>
                      void saveSettings({
                        basePermission: e.target.value as BasePermission,
                      })
                    }
                  >
                    {BASE_OPTS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">
                    {BASE_HELP[state.data.basePermission]}
                  </span>
                </label>

                <label className="ns-settings-toggle">
                  <input
                    type="checkbox"
                    checked={state.data.membersCanCreateRepos}
                    disabled={busy}
                    onChange={(e) =>
                      void saveSettings({
                        membersCanCreateRepos: e.target.checked,
                      })
                    }
                  />
                  <span>
                    <span className="ns-settings-label">
                      Members can create repositories
                    </span>
                    <span className="muted small">
                      When off, only namespace Owners can create repositories
                      here. Instance admins manage the platform and have no data
                      access.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section
              id="ns-rename"
              className="settings-section"
              aria-labelledby="ns-rename-heading"
            >
              <div className="ns-settings-section-head">
                <div>
                  <h2 id="ns-rename-heading">Rename</h2>
                  <p className="muted small">
                    Change the namespace URL slug. Letters, digits, <code>.</code>,{' '}
                    <code>_</code>, and <code>-</code> only. The old name is reserved
                    after rename.
                  </p>
                </div>
              </div>
              <form
                className="inline-form settings-inline-form"
                onSubmit={(e) => void onRename(e)}
              >
                <label className="grow">
                  <span className="visually-hidden">New namespace name</span>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New name"
                    required
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || newName.trim() === '' || newName.trim() === namespace}
                >
                  <ActionPencil size={14} aria-hidden="true" className="button-label-icon" />
                  Rename
                </button>
              </form>
            </section>

            <section
              id="ns-members"
              className="settings-section"
              aria-labelledby="ns-members-heading"
            >
              <div className="ns-settings-section-head">
                <div>
                  <h2 id="ns-members-heading">Members</h2>
                  <p className="muted small">
                    Owners manage this namespace. Members inherit the base
                    permission above.
                  </p>
                  {state.data.unresolvedGroups.length > 0 && (
                    <p className="flash flash-error" role="status">
                      These groups are no longer in the identity provider:{' '}
                      {state.data.unresolvedGroups.join(', ')}
                    </p>
                  )}
                  {state.data.groupBindingWarning && (
                    <p className="flash flash-error" role="status">
                      {state.data.groupBindingWarning}
                    </p>
                  )}
                </div>
                <p className="muted small ns-settings-count">
                  {state.data.members.length} member
                  {state.data.members.length === 1 ? '' : 's'}
                </p>
              </div>

              {state.data.members.length === 0 ? (
                <p className="muted small">No members yet.</p>
              ) : (
                <ul className="ns-member-list">
                  {state.data.members.map((m) => (
                    <li
                      key={
                        m.kind === 'group'
                          ? `group:${m.group}`
                          : `${m.iss}:${m.sub}`
                      }
                      className="ns-member-row"
                    >
                      <div className="ns-member-main">
                        {m.kind === 'group' ? (
                          <>
                            <code className="ns-member-sub">{m.name || m.group}</code>
                            <span className="muted small">
                              {m.bindingMode === 'name-based'
                                ? 'Name-based binding'
                                : m.bindingMode === 'id-based'
                                  ? 'ID-based binding'
                                  : m.name && m.name !== m.group
                                    ? m.group
                                    : 'Group'}
                            </span>
                          </>
                        ) : (
                          <>
                            <code className="ns-member-sub">{m.sub}</code>
                            <span className="muted small">{m.iss}</span>
                          </>
                        )}
                      </div>
                      <span
                        className={
                          m.role === 'owner' ? 'ns-tag ns-tag-accent' : 'ns-tag'
                        }
                      >
                        {m.role}
                      </span>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={busy}
                        onClick={() => void onRemoveMember(m)}
                      >
                        <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form className="ns-member-form" onSubmit={(e) => void onAddMember(e)}>
                <h3 className="ns-settings-subhead">Add member</h3>
                <div className="ns-member-form-fields">
                  <label>
                    Identity
                    <select
                      className="ns-select"
                      value={principalKind}
                      onChange={(e) =>
                        setPrincipalKind(e.target.value as 'user' | 'group')
                      }
                    >
                      <option value="user">User</option>
                      <option value="group">Group</option>
                    </select>
                  </label>
                  {principalKind === 'group' ? (
                    <DirectoryPicker
                      kind="group"
                      group={group}
                      label={groupName}
                      disabled={busy}
                      onChange={({ group: g, name }) => {
                        setGroup(g)
                        setGroupName(name)
                      }}
                    />
                  ) : (
                    <DirectoryPicker
                      kind="user"
                      sub={sub}
                      iss={iss}
                      defaultIss="mice-dev"
                      disabled={busy}
                      onChange={({ sub: s, iss: i }) => {
                        setSub(s)
                        setIss(i)
                      }}
                    />
                  )}
                  <label>
                    Role
                    <select
                      className="ns-select"
                      value={role}
                      onChange={(e) => setRole(e.target.value as MemberRoleRef)}
                    >
                      <optgroup label="Namespace roles">
                        <option value="member">Member</option>
                        <option value="owner">Owner</option>
                      </optgroup>
                      {customRoles.kind === 'ok' &&
                      customRoles.data &&
                      customRoles.data.namespaceRoles.length > 0 ? (
                        <optgroup label="Custom roles">
                          {customRoles.data.namespaceRoles.map((r) => (
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
                      <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />
                      Add member
                    </button>
                  </div>
                </div>
              </form>
            </section>

            <CustomRolesSection namespace={namespace} />

            <section
              id="ns-danger"
              className="danger-zone ns-danger-zone settings-section"
              aria-labelledby="ns-danger-heading"
            >
              <div className="ns-danger-copy">
                <h2 id="ns-danger-heading">Danger zone</h2>
                <p className="muted small">
                  Permanently delete this namespace from AuthZ and remove all of
                  its repositories on oxen-server. This cannot be undone.
                </p>
              </div>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void onDeleteNamespace()}
              >
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />
                Delete namespace
              </button>
            </section>
          </div>
        )}
      </StateBlock>
    </>
  )
}
