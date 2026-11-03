import { ListChecks, Megaphone, ShieldCheck, ShieldUser, Inbox, Check as ActionCheck, Plug as ActionPlug, Save as ActionSave, Settings as ActionSettings, Trash2 as ActionTrash2, UserPlus as ActionUserPlus, X as ActionX, UserX, UserCheck, ShieldAlert, GitCompare, FileText, Ban, UsersRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnnouncementsSection } from '../components/AnnouncementsSection'
import { AdminRevocationSection } from '../components/AdminRevocationSection'
import { SealKeyRotationSection } from '../components/SealKeyRotationSection'
import { MiceSuspensionSection } from '../components/MiceSuspensionSection'
import { AccessReviewSection } from '../components/AccessReviewSection'
import { IdpDriftSection } from '../components/IdpDriftSection'
import { ReenableSection } from '../components/ReenableSection'
import { DisabledSignersSection } from '../components/DisabledSignersSection'
import { GroupBindingSection } from '../components/GroupBindingSection'
import { SectionNav } from '../components/SectionNav'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe, fetchAuthzMe, hasEffectivePermission, isAdminRole, type AuthzMe } from '../lib/auth'
import {
  addInstanceAdmin,
  fetchInstance,
  listAccessRequests,
  removeInstanceAdmin,
  revokeUserSessions,
  resolveAccessRequest,
  setInstancePermissions,
  type AccessRequestRow,
  type InstancePermission,
} from '../lib/authzApi'
import {
  approvableRoles,
  buildApproveBody,
  buildDenyBody,
  filterAccessRequests,
  formatRequestedAccess,
  isAuthorityError,
  type AccessRequestStatusFilter,
} from '../lib/accessRequestReview'
import { profileRoleBadge } from '../lib/profileRoleBadge'
import { togglePermission } from '../lib/requestAccessForm'
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
  const session = useAsync((signal) => fetchAuthMe(signal), [])
  const signedInIss = session.kind === 'ok' && session.data.authenticated ? session.data.user.iss : ''
  const [form, setForm] = useState<OxenSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const isInstanceAdmin = me.kind === 'ok' && !!me.data && isAdminRole(me.data)
  const canReviewAccess =
    me.kind === 'ok' && !!me.data && hasEffectivePermission(me.data, 'access_request:list')
  
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
    { 
      title: 'Access & Permissions', 
      items: [
        ...(canReviewAccess ? [{ id: 'access-requests', label: 'Requests', Icon: Inbox }] : []),
        ...(isInstanceAdmin ? [
          { id: 'user-revocation', label: 'Revocations', Icon: UserX },
          { id: 're-enable', label: 'Re-enable', Icon: UserCheck },
          { id: 'delegated-permissions', label: 'Permissions', Icon: ListChecks },
        ] : []),
      ] 
    },
    ...(isInstanceAdmin ? [
      { 
        title: 'Compliance', 
        items: [
          { id: 'access-review', label: 'Access Review', Icon: FileText },
        ] 
      },
      { 
        title: 'Security', 
        items: [
          { id: 'idp-baseline', label: 'Baseline', Icon: ShieldAlert },
          { id: 'idp-drift', label: 'Drift', Icon: GitCompare },
          { id: 'disabled-signers', label: 'Disabled signers', Icon: ShieldAlert },
          { id: 'mice-suspension', label: 'Suspension', Icon: Ban },
          { id: 'seal-key-rotation', label: 'Keys', Icon: ShieldCheck },
          { id: 'group-binding', label: 'Group binding', Icon: UsersRound },
        ] 
      },
      {
        title: 'Administration',
        items: [
          { id: 'instance-administrators', label: 'Administrators', Icon: ShieldUser },
          { id: 'announcements', label: 'Announcements', Icon: Megaphone },
        ]
      }
    ] : []),
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
          {canReviewAccess && <AccessRequestsSection authz={me.data} />}
          {isInstanceAdmin && <>
            <AdminRevocationSection />
            <ReenableSection />
            <DelegatedPermissionsSection signedInIss={signedInIss} />
            <AccessReviewSection />
            <IdpBaselineSection />
            <IdpDriftSection />
            <DisabledSignersSection />
            <MiceSuspensionSection signedInIss={signedInIss} />
            <SealKeyRotationSection />
            <GroupBindingSection />
            <InstanceAdminSection signedInIss={signedInIss} />
            <AnnouncementsSection />
          </>}
        </>}
      </div>
      </div>
    </main>
  )
}

function AccessRequestsSection({ authz }: { authz: AuthzMe }) {
  const state = useAsync(async (signal) => listAccessRequests(signal), [])
  const [statusFilter, setStatusFilter] = useState<AccessRequestStatusFilter>('pending')
  const [error, setError] = useState<string | null>(null)
  const [authorityError, setAuthorityError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'review' | 'deny'>('review')
  const [grantedRole, setGrantedRole] = useState<string | null>(null)
  const [grantedPermissions, setGrantedPermissions] = useState<string[]>([])
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiryLocalValue)
  const [reason, setReason] = useState('')

  const allRequests = state.kind === 'ok' ? state.data.requests : []
  const requests = filterAccessRequests(allRequests, statusFilter)
  const selected = allRequests.find((r) => r.id === selectedId) ?? null
  const roleChoices = approvableRoles(authz.role)
  const pendingCount = filterAccessRequests(allRequests, 'pending').length

  function openReview(req: AccessRequestRow) {
    setSelectedId(req.id)
    setMode('review')
    setGrantedRole(req.requestedRole ?? null)
    setGrantedPermissions([...(req.requestedPermissions ?? [])])
    setExpiresLocal(defaultExpiryLocalValue())
    setReason('')
    setError(null)
    setAuthorityError(false)
  }

  function openDeny(req: AccessRequestRow) {
    setSelectedId(req.id)
    setMode('deny')
    setReason('')
    setError(null)
    setAuthorityError(false)
  }

  function closeDetail() {
    setSelectedId(null)
    setError(null)
    setAuthorityError(false)
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const expiresAt = new Date(expiresLocal).getTime()
    const built = buildApproveBody({
      expiresAt,
      grantedRole,
      grantedPermissions,
      reason,
    })
    if (!built.ok) {
      setError(built.error)
      setAuthorityError(false)
      return
    }
    setBusy(true)
    setError(null)
    setAuthorityError(false)
    try {
      await resolveAccessRequest(selected.id, built.body)
      closeDetail()
      state.reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approve failed'
      setError(message)
      setAuthorityError(isAuthorityError(message))
    } finally {
      setBusy(false)
    }
  }

  async function onDeny(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const built = buildDenyBody({ reason })
    if (!built.ok) {
      setError(built.error)
      setAuthorityError(false)
      return
    }
    setBusy(true)
    setError(null)
    setAuthorityError(false)
    try {
      await resolveAccessRequest(selected.id, built.body)
      closeDetail()
      state.reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deny failed'
      setError(message)
      setAuthorityError(isAuthorityError(message))
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
          <h2 id="access-requests-heading">
            <Inbox size={18} className="button-label-icon" aria-hidden="true" />
            Access requests
          </h2>
          <p className="muted small">
            Review role and permission requests. You can modify the grant before approving.
          </p>
        </div>
        <p className="muted small ns-settings-count">{pendingCount} pending</p>
      </div>

      <fieldset className="appearance-fieldset" style={{ marginBottom: '1rem' }}>
        <legend>Filter</legend>
        {(['pending', 'approved', 'denied', 'all'] as const).map((f) => (
          <label key={f}>
            <input
              type="radio"
              name="ar-status-filter"
              checked={statusFilter === f}
              onChange={() => setStatusFilter(f)}
            />
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </label>
        ))}
      </fieldset>

      {error && (
        <p className={`flash ${authorityError ? 'flash-warn' : 'flash-error'}`} role="alert">
          {authorityError ? <strong>Authority: </strong> : null}
          {error}
        </p>
      )}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {state.kind === 'error' && (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'ok' && requests.length === 0 && (
        <p className="muted small">No {statusFilter === 'all' ? '' : `${statusFilter} `}requests.</p>
      )}

      {requests.length > 0 && (
        <ul className="ns-member-list">
          {requests.map((r) => (
            <li key={r.id} className="ns-member-row" data-access-request={r.id}>
              <div className="ns-member-main">
                <code className="ns-member-sub">{r.name || r.email}</code>
                <span className="muted small">
                  {r.email}
                  {' · '}
                  {formatRequestedAccess(r)}
                  {' · '}
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                </span>
                {r.message ? <span className="muted small">{r.message}</span> : null}
              </div>
              <span className="ns-tag">{r.status}</span>
              {r.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="btn primary small"
                    disabled={busy}
                    onClick={() => openReview(r)}
                  >
                    <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                    Review
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => openDeny(r)}
                  >
                    <ActionX size={14} aria-hidden="true" className="button-label-icon" />
                    Deny
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected && mode === 'review' && (
        <form className="ns-member-form" onSubmit={onApprove} style={{ marginTop: '1rem' }}>
          <h3 className="ns-settings-subhead">Review request</h3>
          <p className="muted small">
            {selected.name} ({selected.email}) · requested{' '}
            {formatRequestedAccess(selected)}
          </p>
          <div className="ns-settings-grid">
            <label className="ns-settings-field">
              <span className="ns-settings-label">Grant role</span>
              <select
                value={grantedRole ?? ''}
                onChange={(e) => setGrantedRole(e.target.value || null)}
              >
                <option value="">No role (permissions only)</option>
                {roleChoices.map((role) => (
                  <option key={role} value={role}>
                    {profileRoleBadge({ role, pending: false })}
                  </option>
                ))}
              </select>
            </label>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Expires</span>
              <input
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                required
              />
            </label>
          </div>
          <fieldset style={{ marginTop: '0.75rem' }}>
            <legend>Grant permissions (optional modify)</legend>
            <div
              style={{
                maxHeight: '10rem',
                overflow: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                padding: '0.5rem',
              }}
            >
              {authz.permissionCatalog.map((perm) => (
                <label key={perm} className="radio-row" style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={grantedPermissions.includes(perm)}
                    onChange={() =>
                      setGrantedPermissions((prev) => togglePermission(prev, perm))
                    }
                  />
                  <code className="small">{perm}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Approval reason (optional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why this grant is appropriate"
            />
          </label>
          <div className="btn-row ns-settings-actions">
            <button className="btn primary" type="submit" disabled={busy}>
              <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
              {busy ? 'Approving…' : 'Approve'}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={closeDetail}>
              <ActionX size={14} aria-hidden="true" className="button-label-icon" />
              Cancel
            </button>
          </div>
        </form>
      )}

      {selected && mode === 'deny' && (
        <form className="ns-member-form" onSubmit={onDeny} style={{ marginTop: '1rem' }}>
          <h3 className="ns-settings-subhead">Deny request</h3>
          <p className="muted small">
            {selected.name} ({selected.email}) · {formatRequestedAccess(selected)}
          </p>
          <label>
            Denial reason (required)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why this request is denied"
              required
            />
          </label>
          <div className="btn-row ns-settings-actions">
            <button className="btn danger" type="submit" disabled={busy}>
              {busy ? 'Denying…' : 'Deny'}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={closeDetail}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function InstanceAdminSection({ signedInIss }: { signedInIss: string }) {
  const state = useAsync((signal) => fetchInstance(signal), [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminSub, setAdminSub] = useState('')
  const [adminIss, setAdminIss] = useState(signedInIss)
  const [revokeSub, setRevokeSub] = useState('')
  const [revokeIss, setRevokeIss] = useState(signedInIss)
  const [notice, setNotice] = useState<string | null>(null)

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
    const issuer = adminIss.trim() || signedInIss.trim()
    if (!adminSub.trim() || !issuer) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addInstanceAdmin({ sub: adminSub.trim(), iss: issuer })
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
    const issuer = revokeIss.trim() || signedInIss.trim()
    if (!revokeSub.trim() || !issuer) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await revokeUserSessions({ sub: revokeSub.trim(), iss: issuer })
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

  return (
    <>
      {error && <p className="flash flash-error" role="status">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {data && (
        <>
          <section id="instance-administrators" className="settings-section" aria-labelledby="instance-administrators-heading">
          <div className="ns-settings-section-head ns-settings-section-head-tight">
            <div>
              <h2 id="instance-administrators-heading"><ShieldUser size={18} className="button-label-icon" aria-hidden="true" />Instance administrators</h2>
              <p className="muted small">
                Full instance catalog and site-admin bypass.
                At least two instance admins remain, so removal that would leave fewer is refused.
                A Bootstrap mark means this Principal is on AUTHZ_BOOTSTRAP_ADMINS and receives admin again on the next login.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.admins.length === 1 ? '1 admin' : `${data.admins.length} admins`}
            </p>
          </div>
          <ul className="ns-member-list">
            {data.admins.map((a) => (
              <li key={`${a.iss}\0${a.sub}`} className="ns-member-row">
                <div className="ns-member-main">
                  <code className="ns-member-sub">
                    <Link to={`/settings/principal?iss=${encodeURIComponent(a.iss)}&sub=${encodeURIComponent(a.sub)}`}>
                      {a.name || a.email || a.sub}
                    </Link>
                  </code>
                  <span className="muted small">
                    {a.email ? `${a.email} · ` : ''}
                    {a.sub}
                    {' · '}
                    {a.iss}
                  </span>
                </div>
                {a.bootstrap && <span className="ns-tag">bootstrap</span>}
                <span className="ns-tag ns-tag-accent">admin</span>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy || data.admins.length <= 2}
                  title={data.admins.length <= 2 ? 'At least two instance admins must remain' : undefined}
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
                iss={adminIss || signedInIss}
                defaultIss={signedInIss}
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
                iss={revokeIss || signedInIss}
                defaultIss={signedInIss}
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
        </>
      )}
    </>
  )
}

function defaultExpiryLocalValue(): string {
  const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function DelegatedPermissionsSection({ signedInIss }: { signedInIss: string }) {
  const state = useAsync((signal) => fetchInstance(signal), [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [permSub, setPermSub] = useState('')
  const [permIss, setPermIss] = useState(signedInIss)
  const [permChecks, setPermChecks] = useState<InstancePermission[]>([
    'create_namespace',
  ])
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiryLocalValue)

  if (state.kind === 'error') {
    return (
      <section className="settings-section">
        <h2>Delegated permissions</h2>
        <p className="flash flash-error" role="status">{state.message}</p>
      </section>
    )
  }

  const data = state.kind === 'ok' ? state.data : null

  async function onSetPerms(e: FormEvent) {
    e.preventDefault()
    const issuer = permIss.trim() || signedInIss.trim()
    if (!permSub.trim() || !issuer) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    if (permChecks.length > 0 && !expiresLocal.trim()) {
      setError('Expiry date is required for delegated permissions')
      return
    }
    const expiresAt = permChecks.length > 0 ? new Date(expiresLocal).getTime() : undefined
    if (permChecks.length > 0 && (expiresAt == null || !Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
      setError('Expiry must be a future date and time')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setInstancePermissions(
        { sub: permSub.trim(), iss: issuer },
        permChecks,
        expiresAt,
      )
      setPermSub('')
      setExpiresLocal(defaultExpiryLocalValue())
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="flash flash-error" role="status">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {data && (
        <section id="delegated-permissions" className="settings-section" aria-labelledby="delegated-permissions-heading">
          <div className="ns-settings-section-head">
            <div>
              <h2 id="delegated-permissions-heading">
                <ListChecks size={18} className="button-label-icon" aria-hidden="true" />
                Delegated permissions
              </h2>
              <p className="muted small">
                Delegate individual instance permissions to non-admins. Every grant needs an expiry.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.permissions.length === 1 ? '1 grant' : `${data.permissions.length} grants`}
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
                      {' · expires '}
                      {new Date(p.expiresAt).toLocaleString()}
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
                iss={permIss || signedInIss}
                defaultIss={signedInIss}
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setPermSub(sub)
                  setPermIss(iss)
                }}
              />
              <label>
                Expires
                <input
                  type="datetime-local"
                  value={expiresLocal}
                  onChange={(e) => setExpiresLocal(e.target.value)}
                  disabled={busy}
                  required={permChecks.length > 0}
                />
              </label>
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
      )}
    </>
  )
}

function IdpBaselineSection() {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  const status = useAsync(async (signal) => {
    try {
      const res = await fetch('/auth/admin/idp-baseline/status', { signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json() as {
        lastCheck: {
          id: number
          checkedAt: string
          checkedBy: string
          mfaAvailable: boolean
          claimsFound: { acr?: string; amr: string[] } | null
          error: string | null
        } | null
      }
    } catch (err) {
      console.error('Failed to fetch IdP baseline status:', err)
      return null
    }
  }, [])

  async function triggerCheck() {
    setChecking(true)
    setError(null)
    setSuccess(null)
    
    try {
      const res = await fetch('/auth/admin/idp-baseline/check', { method: 'POST' })
      const data = await res.json()
      
      if (!res.ok) {
        setError(data.error || 'Check failed')
      } else {
        setSuccess('Baseline check completed')
        // Refresh status
        status.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <section id="idp-baseline" className="settings-section" aria-labelledby="idp-baseline-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="idp-baseline-heading">
            <ShieldAlert size={18} className="button-label-icon" aria-hidden="true" />
            IdP MFA Baseline
          </h2>
          <p className="muted small">
            Verify that the configured identity provider (IdP) provides MFA evidence (acr/amr claims).
            Part 11 §11.200 requires two distinct identification components for electronic signatures.
          </p>
        </div>
      </div>

      {status.kind === 'ok' && status.data && (
        <div className="ns-settings-grid">
          {status.data.lastCheck ? (
            <>
              <div className="ns-settings-field">
                <span className="ns-settings-label">Last Check</span>
                <p className="muted small">
                  {new Date(status.data.lastCheck.checkedAt).toLocaleString()}
                  {' by '}
                  <code className="inline-code">{status.data.lastCheck.checkedBy}</code>
                </p>
              </div>
              
              <div className="ns-settings-field">
                <span className="ns-settings-label">MFA Available</span>
                <p className={status.data.lastCheck.mfaAvailable ? 'flash flash-success' : 'flash flash-warning'}>
                  {status.data.lastCheck.mfaAvailable ? (
                    <>
                      <ActionCheck size={14} aria-hidden="true" /> Yes
                    </>
                  ) : (
                    <>
                      <ActionX size={14} aria-hidden="true" /> No
                    </>
                  )}
                </p>
              </div>

              {status.data.lastCheck.claimsFound && (
                <div className="ns-settings-field">
                  <span className="ns-settings-label">Claims Found</span>
                  <p className="muted small">
                    <strong>acr:</strong> {status.data.lastCheck.claimsFound.acr || '(none)'}
                    <br />
                    <strong>amr:</strong> {status.data.lastCheck.claimsFound.amr.length > 0 
                      ? status.data.lastCheck.claimsFound.amr.join(', ')
                      : '(none)'}
                  </p>
                </div>
              )}

              {status.data.lastCheck.error && (
                <div className="ns-settings-field">
                  <span className="ns-settings-label">Error</span>
                  <p className="flash flash-warning">{status.data.lastCheck.error}</p>
                </div>
              )}
            </>
          ) : (
            <div className="ns-settings-field">
              <p className="muted">No baseline checks have been performed yet.</p>
            </div>
          )}
        </div>
      )}

      <div className="btn-row ns-settings-actions">
        <button 
          className="btn primary" 
          type="button" 
          onClick={triggerCheck}
          disabled={checking}
        >
          <ShieldAlert size={14} aria-hidden="true" className="button-label-icon" />
          {checking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {success && <p className="flash flash-success" role="status">{success}</p>}
    </section>
  )
}
