import { ListChecks, Megaphone, ShieldCheck, ShieldUser, Inbox, Check as ActionCheck, Plug as ActionPlug, Save as ActionSave, Settings as ActionSettings, Trash2 as ActionTrash2, UserPlus as ActionUserPlus, X as ActionX, UserX } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { AnnouncementsSection } from '../components/AnnouncementsSection'
import { AdminRevocationSection } from '../components/AdminRevocationSection'
import { SectionNav } from '../components/SectionNav'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import {
  addInstanceAdmin,
  fetchInstance,
  listAccessRequests,
  listAuthzNamespaces,
  patchInstanceEnforce,
  removeInstanceAdmin,
  revokeUserSessions,
  resolveAccessRequest,
  setInstancePermissions,
  type AccessRequestRow,
  type InstancePermission,
  type MemberRoleRef,
} from '../lib/authzApi'
import { fetchServerVersion } from '../lib/oxen/api'
import {
  loadSettings,
  saveSettings,
  type OxenSettings,
} from '../lib/oxen/settings'

const INSTANCE_PERMS: InstancePermission[] = [
  'create_namespace',
  'view_audit',
  'view_lineage',
  'manage_own_tokens',
  'cli_device_approve',
  'session_create',
  'session_connect',
  'session_admin',
]

export function SettingsPage() {
  const me = useAsync((signal) => fetchAuthzMe(signal), [])
  const [form, setForm] = useState<OxenSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const isInstanceAdmin = me.kind === 'ok' && !!me.data?.instanceAdmin

  function onSave(e: FormEvent) {
    e.preventDefault()
    saveSettings(form)
    setSaved(true)
    setProbe(null)
    window.setTimeout(() => setSaved(false), 1500)
  }

  async function onTest() {
    saveSettings(form)
    setProbe('Testing…')
    try {
      const res = await fetchServerVersion()
      setProbe(`Connected · oxen-server v${res.oxen_version}`)
    } catch (err) {
      setProbe(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  const groups = [
    { title: 'General', items: [{ id: 'connection', label: 'Connection', Icon: ActionPlug }] },
    { title: 'Access', items: [{ id: 'access-requests', label: 'Access requests', Icon: Inbox }] },
    ...(isInstanceAdmin ? [{ title: 'Administration', items: [
      { id: 'authorization-policy', label: 'Authorization policy', Icon: ShieldCheck },
      { id: 'instance-administrators', label: 'Instance administrators', Icon: ShieldUser },
      { id: 'delegated-permissions', label: 'Delegated permissions', Icon: ListChecks },
      { id: 'user-revocation', label: 'User revocation', Icon: UserX },
      { id: 'announcements', label: 'Announcements', Icon: Megaphone },
    ] }] : []),
  ]

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            Manage connection settings and instance access.
            Personal preferences and CLI tokens are in your profile.
          </p>
        </div>
      </div>

      <div className="profile-layout">
      <SectionNav label="Settings sections" groups={groups} />
      <div className="ns-settings profile-sections">
        <section id="connection" className="settings-section" aria-labelledby="connection-heading">
          <div className="ns-settings-section-head">
            <div>
              <h2 id="connection-heading"><ActionPlug size={18} className="button-label-icon" aria-hidden="true" />Connection</h2>
              <p className="muted small">
                Leave the API base empty for the same-origin auth proxy.
                Sign-in and commit identity are managed by SSO.
              </p>
            </div>
          </div>
          <form className="ns-member-form" onSubmit={onSave}>
            <div className="ns-settings-grid">
              <label className="ns-settings-field">
                <span className="ns-settings-label">API base URL</span>
                <input value={form.apiBase} onChange={(e) => setForm((f) => ({ ...f, apiBase: e.target.value }))}
                  placeholder="(empty = same-origin /api)" autoComplete="off" />
              </label>
            </div>
            <div className="btn-row ns-settings-actions">
              <button className="btn primary" type="submit"><ActionSave size={14} aria-hidden="true" className="button-label-icon" />Save</button>
              <button className="btn ghost" type="button" onClick={onTest}><ActionPlug size={14} aria-hidden="true" className="button-label-icon" />Test connection</button>
            </div>
            {saved && <p className="flash flash-success" role="status">Saved.</p>}
            {probe && <p className="muted">{probe}</p>}
          </form>
        </section>

        {me.kind === 'ok' && me.data && <>
          <AccessRequestsSection isInstanceAdmin={!!isInstanceAdmin} />
          {isInstanceAdmin && <InstanceAdminSection />}
          {isInstanceAdmin && <AdminRevocationSection />}
          {isInstanceAdmin && <AnnouncementsSection />}
        </>}
      </div>
      </div>
    </main>
  )
}

function AccessRequestsSection({
  isInstanceAdmin,
}: {
  isInstanceAdmin: boolean
}) {
  const state = useAsync(async (signal) => {
    try {
      return await listAccessRequests(signal)
    } catch {
      return null
    }
  }, [])
  const nsList = useAsync(async (signal) => {
    try {
      const data = await listAuthzNamespaces(signal)
      return data.namespaces
    } catch {
      return []
    }
  }, [])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [approveNs, setApproveNs] = useState('')
  const [approveRole, setApproveRole] = useState<MemberRoleRef>('member')
  const [approvePerm, setApprovePerm] = useState<InstancePermission | ''>('')

  if (state.kind === 'ok' && state.data === null) return null

  const requests =
    state.kind === 'ok' && state.data
      ? state.data.requests.filter((r) => r.status === 'pending')
      : []
  const reviewNamespaces =
    state.kind === 'ok' && state.data ? state.data.reviewNamespaces : []
  const nsOptions =
    nsList.kind === 'ok'
      ? nsList.data.filter(
          (n) =>
            isInstanceAdmin ||
            n.role === 'owner' ||
            reviewNamespaces.includes(n.name),
        )
      : []

  async function onDeny(req: AccessRequestRow) {
    setBusy(true)
    setError(null)
    try {
      await resolveAccessRequest(req.id, 'deny')
      state.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deny failed')
    } finally {
      setBusy(false)
    }
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault()
    if (!approveId) return
    setBusy(true)
    setError(null)
    try {
      if (approvePerm && isInstanceAdmin) {
        await resolveAccessRequest(approveId, 'approve', {
          permission: approvePerm,
        })
      } else if (approveNs) {
        await resolveAccessRequest(approveId, 'approve', {
          namespace: approveNs,
          role: approveRole,
        })
      } else if (isInstanceAdmin) {
        await resolveAccessRequest(approveId, 'approve')
      } else {
        throw new Error('Choose a namespace to approve into')
      }
      setApproveId(null)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="access-requests"
      className="settings-section"
      aria-labelledby="access-requests-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-requests-heading"><Inbox size={18} className="button-label-icon" aria-hidden="true" />Access requests</h2>
          <p className="muted small">
            Pending SSO users waiting for a namespace seat or instance
            permission.
          </p>
        </div>
        <p className="muted small ns-settings-count">
          {requests.length} pending
        </p>
      </div>
      {error && <p className="flash flash-error" role="status">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {state.kind === 'ok' && requests.length === 0 && (
        <p className="muted small">No pending requests.</p>
      )}
      {requests.length > 0 && (
        <ul className="ns-member-list">
          {requests.map((r) => (
            <li
              key={r.id}
              className="ns-member-row"
              data-access-request={r.id}
            >
              <div className="ns-member-main">
                <code className="ns-member-sub">{r.name}</code>
                <span className="muted small">
                  {r.email}
                  {' · '}
                  <span className="mono">
                    {r.sub}@{r.iss}
                  </span>
                </span>
                {r.message ? (
                  <span className="muted small">{r.message}</span>
                ) : null}
              </div>
              <span className="ns-tag">pending</span>
              <button
                type="button"
                className="btn primary small"
                disabled={busy}
                onClick={() => {
                  setApproveId(r.id)
                  setApproveNs(nsOptions[0]?.name ?? '')
                  setApproveRole('member')
                  setApprovePerm('')
                }}
              >
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />Approve
              </button>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => void onDeny(r)}
              >
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />Deny
              </button>
            </li>
          ))}
        </ul>
      )}

      {approveId && (
        <form className="ns-member-form" onSubmit={onApprove}>
          <h3 className="ns-settings-subhead">Approve request</h3>
          <div className="ns-member-form-fields cols-3">
            {isInstanceAdmin && (
              <label>
                Instance permission
                <select
                  value={approvePerm}
                  onChange={(e) =>
                    setApprovePerm(e.target.value as InstancePermission | '')
                  }
                >
                  <option value="">Namespace seat…</option>
                  {INSTANCE_PERMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!approvePerm && (
              <>
                <label>
                  Namespace
                  <select
                    value={approveNs}
                    onChange={(e) => setApproveNs(e.target.value)}
                    required={!isInstanceAdmin}
                  >
                    <option value="">Select namespace</option>
                    {nsOptions.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Role
                  <select
                    value={approveRole}
                    onChange={(e) =>
                      setApproveRole(e.target.value as MemberRoleRef)
                    }
                  >
                    <option value="member">member</option>
                    <option value="owner">owner</option>
                  </select>
                </label>
              </>
            )}
            <div className="ns-member-form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />Confirm
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={busy}
                onClick={() => setApproveId(null)}
              >
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}

function InstanceAdminSection() {
  const state = useAsync((signal) => fetchInstance(signal), [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminSub, setAdminSub] = useState('')
  const [adminIss, setAdminIss] = useState('mice-dev')
  const [revokeSub, setRevokeSub] = useState('')
  const [revokeIss, setRevokeIss] = useState('mice-dev')
  const [notice, setNotice] = useState<string | null>(null)
  const [permSub, setPermSub] = useState('')
  const [permIss, setPermIss] = useState('mice-dev')
  const [permChecks, setPermChecks] = useState<InstancePermission[]>([
    'create_namespace',
  ])

  if (state.kind === 'error') {
    return (
      <section className="settings-section">
        <h2>Instance admin</h2>
        <p className="flash flash-error" role="status">{state.message}</p>
      </section>
    )
  }

  const data = state.kind === 'ok' ? state.data : null

  async function onAddAdmin(e: FormEvent) {
    e.preventDefault()
    if (!adminSub.trim() || !adminIss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addInstanceAdmin({ sub: adminSub.trim(), iss: adminIss.trim() })
      setAdminSub('')
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function onRevokeSessions(e: FormEvent) {
    e.preventDefault()
    if (!revokeSub.trim() || !revokeIss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await revokeUserSessions({ sub: revokeSub.trim(), iss: revokeIss.trim() })
      setNotice(`Revoked all sessions of ${revokeSub.trim()}`)
      setRevokeSub('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveAdmin(sub: string, iss: string) {
    setBusy(true)
    setError(null)
    try {
      await removeInstanceAdmin({ sub, iss })
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSetPerms(e: FormEvent) {
    e.preventDefault()
    if (!permSub.trim() || !permIss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setInstancePermissions(
        { sub: permSub.trim(), iss: permIss.trim() },
        permChecks,
      )
      setPermSub('')
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function onToggleEnforce() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      await patchInstanceEnforce(!data.enforce)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="flash flash-error" role="status">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {data && (
        <>
          <section id="authorization-policy" className="settings-section" aria-labelledby="authorization-policy-heading">
          <h2 id="authorization-policy-heading"><ShieldCheck size={18} className="button-label-icon" aria-hidden="true" />Authorization policy</h2>
          <p className="muted small">Control whether namespace, repository, and instance permissions are enforced.</p>
          <label className="ns-settings-toggle">
            <input
              type="checkbox"
              checked={data.enforce}
              disabled={busy}
              onChange={() => void onToggleEnforce()}
            />
            <span>
              <span className="ns-settings-label">AuthZ enforce</span>
              <span className="muted small">
                Currently {data.enforce ? 'on' : 'off'}. Env{' '}
                <code>AUTHZ_ENFORCE</code> overrides this store flag when set.
              </span>
            </span>
          </label>
          </section>

          <section id="instance-administrators" className="settings-section" aria-labelledby="instance-administrators-heading">
          <div className="ns-settings-section-head ns-settings-section-head-tight">
            <div>
              <h2 id="instance-administrators-heading"><ShieldUser size={18} className="button-label-icon" aria-hidden="true" />Instance administrators</h2>
              <p className="muted small">
                Full instance catalog and site-admin bypass.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.admins.length} admin{data.admins.length === 1 ? '' : 's'}
            </p>
          </div>
          <ul className="ns-member-list">
            {data.admins.map((a) => (
              <li key={`${a.iss}\0${a.sub}`} className="ns-member-row">
                <div className="ns-member-main">
                  <code className="ns-member-sub">{a.sub}</code>
                  <span className="muted small">{a.iss}</span>
                </div>
                <span className="ns-tag ns-tag-accent">admin</span>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => void onRemoveAdmin(a.sub, a.iss)}
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                </button>
              </li>
            ))}
          </ul>
          <form className="ns-member-form" onSubmit={onAddAdmin}>
            <h3 className="ns-settings-subhead">Add admin</h3>
            <div className="ns-member-form-fields">
              <DirectoryPicker
                kind="user"
                sub={adminSub}
                iss={adminIss}
                defaultIss="mice-dev"
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setAdminSub(sub)
                  setAdminIss(iss)
                }}
              />
              <div className="ns-member-form-actions">
                <button className="btn primary" type="submit" disabled={busy}>
                  <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />Add admin
                </button>
              </div>
            </div>
          </form>
          <form className="ns-member-form" onSubmit={onRevokeSessions}>
            <h3 className="ns-settings-subhead">Revoke sessions</h3>
            <p className="muted small">Signs the user out everywhere, immediately. They can sign in again.</p>
            <div className="ns-member-form-fields">
              <DirectoryPicker
                kind="user"
                sub={revokeSub}
                iss={revokeIss}
                defaultIss="mice-dev"
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setRevokeSub(sub)
                  setRevokeIss(iss)
                }}
              />
              <div className="ns-member-form-actions">
                <button className="btn danger" type="submit" disabled={busy}>Revoke sessions</button>
              </div>
            </div>
            {notice ? <p className="muted small" role="status">{notice}</p> : null}
          </form>
          </section>

          <section id="delegated-permissions" className="settings-section" aria-labelledby="delegated-permissions-heading">
          <div className="ns-settings-section-head ns-settings-section-head-spaced">
            <div>
              <h2 id="delegated-permissions-heading"><ListChecks size={18} className="button-label-icon" aria-hidden="true" />Delegated permissions</h2>
              <p className="muted small">
                Delegate individual instance permissions to non-admins.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.permissions.length} grant
              {data.permissions.length === 1 ? '' : 's'}
            </p>
          </div>
          {data.permissions.length === 0 ? (
            <p className="muted small">No delegated grants.</p>
          ) : (
            <ul className="ns-member-list">
              {data.permissions.map((p) => (
                <li key={`${p.iss}\0${p.sub}`} className="ns-member-row">
                  <div className="ns-member-main">
                    <code className="ns-member-sub">{p.sub}</code>
                    <span className="muted small">
                      {p.iss}
                      {' · '}
                      {p.permissions.join(', ')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() =>
                      void setInstancePermissions(
                        { sub: p.sub, iss: p.iss },
                        [],
                      ).then(() => state.reload())
                    }
                  >
                    <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="ns-member-form" onSubmit={onSetPerms}>
            <h3 className="ns-settings-subhead">Set permissions</h3>
            <div className="ns-member-form-fields">
              <DirectoryPicker
                kind="user"
                sub={permSub}
                iss={permIss}
                defaultIss="mice-dev"
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setPermSub(sub)
                  setPermIss(iss)
                }}
              />
            </div>
            <fieldset className="ns-check-fieldset">
              <legend>Permissions</legend>
              <div className="ns-check-grid">
                {INSTANCE_PERMS.map((p) => (
                  <label key={p} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={permChecks.includes(p)}
                      onChange={(e) => {
                        setPermChecks((prev) =>
                          e.target.checked
                            ? [...prev, p]
                            : prev.filter((x) => x !== p),
                        )
                      }}
                    />
                    <span>{p}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="ns-member-form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionSettings size={14} aria-hidden="true" className="button-label-icon" />Set permissions
              </button>
            </div>
          </form>
          </section>
        </>
      )}
    </>
  )
}
