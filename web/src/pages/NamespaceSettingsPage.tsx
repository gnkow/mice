import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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

export function NamespaceSettingsPage() {
  const { namespace = '' } = useParams()
  const navigate = useNavigate()
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
  const [principalKind, setPrincipalKind] = useState<'user' | 'group'>('user')
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState('boxen-dev')
  const [group, setGroup] = useState('')
  const [role, setRole] = useState<MemberRoleRef>('member')

  async function saveSettings(patch: {
    basePermission?: BasePermission
    membersCanCreateRepos?: boolean
  }) {
    setBusy(true)
    setError(null)
    try {
      await patchNamespaceAuthz(namespace, patch)
      state.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
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
          role,
        })
        setGroup('')
      } else {
        await putNamespaceMember(namespace, {
          kind: 'user',
          sub: sub.trim(),
          iss: iss.trim(),
          role,
        })
        setSub('')
      }
      state.reload()
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
      state.reload()
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
    <main className="page wide">
      <div className="page-head">
        <div>
          <p className="crumb">
            <Link to="/namespaces">Namespaces</Link>
            <span aria-hidden> / </span>
            <Link to={`/n/${encodeURIComponent(namespace)}`}>{namespace}</Link>
            <span aria-hidden> / </span>
            <span>Settings</span>
          </p>
          <h1>Settings</h1>
          <p className="lede">
            Membership, default repository access, and namespace lifecycle for{' '}
            <code>{namespace}</code>.
          </p>
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}`}
          >
            View namespace
          </Link>
          <Link
            className="btn primary"
            to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}
          >
            + New repository
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' && (
          <div className="ns-settings">
            <section
              className="settings-section"
              aria-labelledby="ns-general-heading"
            >
              <h2 id="ns-general-heading">General</h2>
              <p className="muted small">
                Base permissions apply to every Member on repositories in this
                namespace (GitHub-style org base role). Suggested default:{' '}
                <code>none</code>.
              </p>

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
                      When off, only Owners (and instance admins) can create
                      repositories here.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section
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
                            <code className="ns-member-sub">{m.group}</code>
                            <span className="muted small">Group</span>
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
                          m.role === 'owner'
                            ? 'ns-tag ns-tag-accent'
                            : 'ns-tag'
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
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form className="ns-member-form" onSubmit={onAddMember}>
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
                      disabled={busy}
                      onChange={({ group: g }) => setGroup(g)}
                    />
                  ) : (
                    <DirectoryPicker
                      kind="user"
                      sub={sub}
                      iss={iss}
                      defaultIss="boxen-dev"
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
                      onChange={(e) =>
                        setRole(e.target.value as MemberRoleRef)
                      }
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
                    <button
                      className="btn primary"
                      type="submit"
                      disabled={busy}
                    >
                      Add member
                    </button>
                  </div>
                </div>
              </form>
            </section>

            <CustomRolesSection namespace={namespace} />

            <section
              className="danger-zone ns-danger-zone"
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
                Delete namespace
              </button>
            </section>
          </div>
        )}
      </StateBlock>
    </main>
  )
}
