import {
  ListChecks,
  Megaphone,
  ShieldUser,
  Inbox,
  Check as ActionCheck,
  Plug as ActionPlug,
  Save as ActionSave,
  Settings as ActionSettings,
  Trash2 as ActionTrash2,
  UserPlus as ActionUserPlus,
  X as ActionX,
  UserCheck,
  ShieldAlert,
  ShieldOff,
  Shield,
  Link2,
  GitCompare,
  FileText,
  Ban,
  HeartPulse,
  Key,
  UsersRound,
  Package,
  Scale,
  DatabaseBackup,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AnnouncementsSection } from '../components/AnnouncementsSection'
import { AdminRevocationSection } from '../components/AdminRevocationSection'
import { RestoreTestSection } from '../components/RestoreTestSection'
import { SealKeyRotationSection } from '../components/SealKeyRotationSection'
import { MiceSuspensionSection } from '../components/MiceSuspensionSection'
import { AccessReviewSection } from '../components/AccessReviewSection'
import { IdpDriftSection } from '../components/IdpDriftSection'
import { ReenableSection } from '../components/ReenableSection'
import { DisabledSignersSection } from '../components/DisabledSignersSection'
import { UserRef } from '../components/UserRef'
import { GroupBindingSection } from '../components/GroupBindingSection'
import { Pagination, paginate } from '../components/Pagination'
import { SectionNav } from '../components/SectionNav'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe, fetchAuthzMe, hasEffectivePermission, isAdminRole, type AuthzMe } from '../lib/auth'
import {
  fetchInstance,
  grantPermissions,
  grantRole,
  listAccessRequests,
  listRbacUsers,
  revokeUserSessions,
  resolveAccessRequest,
  setInstancePermissions,
  type AccessRequestRow,
  type InstancePermission,
  type RbacUserRow,
} from '../lib/authzApi'
import {
  approvableRoles,
  buildApproveBody,
  buildDenyBody,
  extrasBeyondRole,
  filterAccessRequests,
  formatRequestedAccess,
  isAdminFloorError,
  isAuthorityError,
  selectGrantRolePermissions,
  type AccessRequestStatusFilter,
} from '../lib/accessRequestReview'
import {
  SIGNED_MUTATION_COMPLETE_EVENT,
  type PendingSignedMutation,
} from '../lib/signingResume'
import { buildDirectGrantBodies } from '../lib/directGrantForm'
import { delegatedExpiryLabel, delegatedExpiryTone } from '../lib/delegatedExpiry'
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
  const [probeTick, setProbeTick] = useState(0)
  const serverInfo = useAsync(
    (signal) => fetchServerVersion(signal),
    [form.apiBase, probeTick],
  )
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
      setProbeTick((t) => t + 1)
    } catch (err) {
      setProbe(err instanceof Error ? err.message : 'Connection failed')
      setProbeTick((t) => t + 1)
    }
  }

  // Order: frequent day-to-day access work → IdP trust → audit integrity → rare instance ops.
  // Nav groups and DOM section order stay identical so scrollspy / keyboard order match.
  const groups = [
    { title: 'General', Icon: ActionSettings, items: [{ id: 'connection', label: 'Connection', Icon: ActionPlug }] },
    {
      title: 'Access',
      Icon: UsersRound,
      items: [
        ...(canReviewAccess
          ? [
              { id: 'access-requests', label: 'Access requests', Icon: Inbox },
              { id: 'users-grant', label: 'Grant access', Icon: UsersRound },
            ]
          : []),
        ...(isInstanceAdmin
          ? [
              { id: 'delegated-permissions', label: 'Delegated permissions', Icon: ListChecks },
              { id: 'user-revocation', label: 'User Revocation', Icon: Shield },
              { id: 're-enable', label: 'Re-enable', Icon: UserCheck },
              { id: 'access-review', label: 'Quarterly Access Review', Icon: FileText },
            ]
          : []),
      ],
    },
    ...(isInstanceAdmin
      ? [
          {
            title: 'Identity',
            Icon: ShieldAlert,
            items: [
              { id: 'idp-baseline', label: 'IdP MFA Baseline', Icon: ShieldAlert },
              { id: 'idp-drift', label: 'IdP drift', Icon: GitCompare },
              { id: 'disabled-signers', label: 'Disabled signers', Icon: ShieldOff },
              { id: 'mice-suspension', label: 'Mice suspension', Icon: Ban },
              { id: 'group-binding', label: 'Group binding validation', Icon: Link2 },
            ],
          },
          {
            title: 'Audit',
            Icon: HeartPulse,
            items: [
              { id: 'audit-health', label: 'Audit health', Icon: HeartPulse },
              { id: 'seal-key-rotation', label: 'Session cookie keys', Icon: Key },
              { id: 'restore-test', label: 'Restore test', Icon: DatabaseBackup },
            ],
          },
          {
            title: 'Instance',
            Icon: ShieldUser,
            items: [
              { id: 'regulated-config', label: 'Regulated config', Icon: Scale },
              { id: 'release-manifest', label: 'Release manifest', Icon: Package },
              { id: 'instance-administrators', label: 'Instance administrators', Icon: ShieldUser },
              { id: 'announcements', label: 'Announcements', Icon: Megaphone },
            ],
          },
        ]
      : []),
  ].filter((group) => group.items.length > 0)

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            Connection, access, identity, and audit controls for this instance.
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
            <dl className="ns-settings-facts" aria-label="Server">
              <div className="ns-settings-fact">
                <dt className="ns-settings-fact-label">oxen-server</dt>
                <dd className="ns-settings-fact-value" role="status">
                  {serverInfo.kind === 'ok'
                    ? `v${serverInfo.data.oxen_version}`
                    : serverInfo.kind === 'error'
                      ? 'Unreachable'
                      : 'Checking…'}
                </dd>
              </div>
            </dl>
          </form>
        </section>

        {me.kind === 'ok' && me.data && <>
          {canReviewAccess && <>
            <AccessRequestsSection authz={me.data} />
            <UsersGrantSection authz={me.data} signedInIss={signedInIss} />
          </>}
          {isInstanceAdmin && <>
            <DelegatedPermissionsSection signedInIss={signedInIss} />
            <AdminRevocationSection />
            <ReenableSection />
            <AccessReviewSection />
            <IdpBaselineSection />
            <IdpDriftSection />
            <DisabledSignersSection />
            <MiceSuspensionSection signedInIss={signedInIss} />
            <GroupBindingSection />
            <AuditHealthSection />
            <SealKeyRotationSection />
            <RestoreTestSection />
            <RegulatedConfigSection />
            <ReleaseManifestSection />
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

  const reloadRequests = state.reload
  useEffect(() => {
    function onComplete(e: Event) {
      const intent = (e as CustomEvent<PendingSignedMutation>).detail
      if (!intent?.apiPath?.includes('/access-requests/')) return
      setSelectedId(null)
      setError(null)
      reloadRequests()
    }
    window.addEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    return () => window.removeEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
  }, [reloadRequests])

  function openReview(req: AccessRequestRow) {
    const role = req.requestedRole ?? null
    setSelectedId(req.id)
    setMode('review')
    setGrantedRole(role)
    setGrantedPermissions(
      selectGrantRolePermissions({
        role,
        rolePermissions: authz.rolePermissions,
        extras: req.requestedPermissions,
      }),
    )
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
      // Role bundle is shown checked in the UI; only extras are custom grants.
      grantedPermissions: extrasBeyondRole(
        grantedRole,
        grantedPermissions,
        authz.rolePermissions,
      ),
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
            IdP groups never auto-grant instance roles. Review requests here, or{' '}
            <a href="#users-grant">assign a role directly</a>. You can modify the grant
            before approving.
          </p>
        </div>
        <p className="muted small ns-settings-count" data-testid="access-requests-pending-count">
          {pendingCount} pending
        </p>
      </div>

      <fieldset className="appearance-fieldset auth-panel-stack">
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
        <p
          className={`flash ${authorityError ? 'flash-warn' : 'flash-error'}`}
          role="alert"
          id="access-request-authority-error"
        >
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
        <div className="grant-access-empty" role="status" data-testid="access-requests-empty">
          <p className="muted small">
            No {statusFilter === 'all' ? '' : `${statusFilter} `}requests.
          </p>
          {statusFilter === 'pending' ? (
            <p className="muted small">
              New principals stay pending until a manager approves a request or grants
              access manually — group membership alone does not unlock the app.
            </p>
          ) : null}
        </div>
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
        <form className="ns-member-form auth-panel-stack" onSubmit={onApprove}>
          <h3 className="ns-settings-subhead">Review request</h3>
          <p className="muted small">
            {selected.name} ({selected.email}) · requested{' '}
            {formatRequestedAccess(selected)}
          </p>
          <p className="muted small" data-testid="access-request-authority-hint">
            You can only approve grants within your authority. Expiry is required for
            delegated roles and custom permissions.
          </p>
          <div className="ns-settings-grid">
            <label className="ns-settings-field">
              <span className="ns-settings-label">Grant role</span>
              <select
                value={grantedRole ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  const extras = extrasBeyondRole(
                    grantedRole,
                    grantedPermissions,
                    authz.rolePermissions,
                  )
                  setGrantedRole(next)
                  setGrantedPermissions(
                    selectGrantRolePermissions({
                      role: next,
                      rolePermissions: authz.rolePermissions,
                      extras,
                    }),
                  )
                }}
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
          <fieldset>
            <legend>Grant permissions (optional modify)</legend>
            <p className="muted small">
              Permissions included in the selected role are checked automatically. Add
              extras below if you need more than the role provides.
            </p>
            <div className="perm-multiselect perm-multiselect-compact">
              {authz.permissionCatalog.map((perm) => {
                const inRole = Boolean(
                  grantedRole &&
                    authz.rolePermissions?.[grantedRole]?.includes(perm),
                )
                return (
                  <label key={perm} className="radio-row">
                    <input
                      type="checkbox"
                      checked={grantedPermissions.includes(perm)}
                      disabled={inRole}
                      onChange={() => {
                        if (inRole) return
                        setGrantedPermissions((prev) => togglePermission(prev, perm))
                      }}
                    />
                    <code className="small">{perm}</code>
                    {inRole ? (
                      <span className="muted small"> (in role)</span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>
          <p className="muted small" data-testid="access-request-approve-reason-hint">
            Approving opens the signing ceremony — the reason you enter there is bound to the
            electronic signature for this approval.
          </p>
          <div className="btn-row ns-settings-actions">
            <button
              className="btn primary"
              type="submit"
              disabled={busy}
              aria-busy={busy || undefined}
            >
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
        <form className="ns-member-form auth-panel-stack" onSubmit={onDeny}>
          <h3 className="ns-settings-subhead">Deny request</h3>
          <p className="muted small">
            {selected.name} ({selected.email}) · {formatRequestedAccess(selected)}
          </p>
          <label htmlFor="access-request-deny-reason">
            Denial reason (required)
            <textarea
              id="access-request-deny-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why this request is denied"
              required
              aria-describedby={error ? 'access-request-authority-error' : undefined}
            />
          </label>
          <div className="btn-row ns-settings-actions">
            <button
              className="btn danger"
              type="submit"
              disabled={busy}
              aria-busy={busy || undefined}
            >
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

/** Page size for Settings → Grant access (latest principals first). */
const GRANT_ACCESS_PAGE_SIZE = 5

function UsersGrantSection({
  authz,
  signedInIss,
}: {
  authz: AuthzMe
  signedInIss: string
}) {
  const state = useAsync((signal) => listRbacUsers(signal), [])
  const instance = useAsync((signal) => fetchInstance(signal), [])
  const [error, setError] = useState<string | null>(null)
  const [authorityError, setAuthorityError] = useState(false)
  const [adminFloorError, setAdminFloorError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [grantOpen, setGrantOpen] = useState(false)
  const [targetSub, setTargetSub] = useState('')
  const [targetIss, setTargetIss] = useState(signedInIss)
  const [grantRoleValue, setGrantRoleValue] = useState<string | null>('user')
  const [grantPerms, setGrantPerms] = useState<string[]>([])
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiryLocalValue)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const users = state.kind === 'ok' ? state.data.users : []
  const pageSlice = paginate(users, page, GRANT_ACCESS_PAGE_SIZE)
  const roleChoices = approvableRoles(authz.role)
  const admins = instance.kind === 'ok' ? instance.data.admins : []
  const adminCount = admins.length
  const targetIsAdmin = admins.some(
    (a) => a.sub === targetSub.trim() && a.iss === (targetIss.trim() || signedInIss),
  )
  const demotingAdmin =
    Boolean(grantRoleValue) &&
    grantRoleValue !== 'admin' &&
    targetIsAdmin
  const floorBlocksDemotion = demotingAdmin && adminCount <= 2

  const reloadUsers = state.reload
  const reloadInstance = instance.reload
  useEffect(() => {
    function onComplete(e: Event) {
      const intent = (e as CustomEvent<PendingSignedMutation>).detail
      if (!intent?.apiPath?.includes('/auth/grants/')) return
      setGrantOpen(false)
      setNotice('Granted access')
      reloadUsers()
      reloadInstance()
    }
    window.addEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    return () => window.removeEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
  }, [reloadUsers, reloadInstance])

  function openGrant(user?: RbacUserRow) {
    const role = roleChoices[0] ?? null
    setGrantOpen(true)
    setTargetSub(user?.sub ?? '')
    setTargetIss(user?.iss ?? signedInIss)
    setGrantRoleValue(role)
    setGrantPerms(
      selectGrantRolePermissions({
        role,
        rolePermissions: authz.rolePermissions,
      }),
    )
    setExpiresLocal(defaultExpiryLocalValue())
    setError(null)
    setAuthorityError(false)
    setAdminFloorError(false)
    setNotice(null)
  }

  async function onGrant(e: FormEvent) {
    e.preventDefault()
    if (floorBlocksDemotion) {
      setAdminFloorError(true)
      setAuthorityError(false)
      setError('At least two instance admins must remain')
      return
    }
    const expiresAt = new Date(expiresLocal).getTime()
    const built = buildDirectGrantBodies({
      sub: targetSub,
      iss: targetIss,
      role: grantRoleValue,
      // Role bundle is shown checked; only extras become custom grants.
      permissions: extrasBeyondRole(
        grantRoleValue,
        grantPerms,
        authz.rolePermissions,
      ),
      expiresAt,
    })
    if (!built.ok) {
      setError(built.error)
      setAuthorityError(false)
      setAdminFloorError(false)
      return
    }
    setBusy(true)
    setError(null)
    setAuthorityError(false)
    setAdminFloorError(false)
    setNotice(null)
    try {
      for (const item of built.bodies) {
        if (item.kind === 'role') await grantRole(item.body)
        else await grantPermissions(item.body)
      }
      setNotice(`Granted access to ${targetSub.trim() || 'principal'}`)
      setGrantOpen(false)
      state.reload()
      instance.reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Grant failed'
      setError(message)
      setAuthorityError(isAuthorityError(message))
      setAdminFloorError(isAdminFloorError(message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="users-grant"
      className="settings-section"
      aria-labelledby="users-grant-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="users-grant-heading">
            <UsersRound size={18} className="button-label-icon" aria-hidden="true" />
            Grant access
          </h2>
          <p className="muted small">
            Managers assign roles and permissions explicitly. IdP groups do not bootstrap
            instance access — only the bootstrap admin allowlist and grants you make here
            (or via <a href="#access-requests">pending access requests</a>). Changing an
            Admin to another role is refused while two or fewer instance admins remain.
          </p>
        </div>
        <button type="button" className="btn primary small" onClick={() => openGrant()}>
          <ActionUserPlus size={14} aria-hidden="true" className="button-label-icon" />
          Grant Access
        </button>
      </div>

      {error && (
        <p
          className={`flash ${authorityError || adminFloorError ? 'flash-warn' : 'flash-error'}`}
          role="alert"
        >
          {adminFloorError ? <strong>Admin floor: </strong> : null}
          {authorityError && !adminFloorError ? <strong>Authority: </strong> : null}
          {error}
        </p>
      )}
      {notice && <p className="flash flash-success" role="status">{notice}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {state.kind === 'error' && (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'ok' && users.length === 0 && (
        <div className="grant-access-empty" role="status" data-testid="users-grant-empty">
          <p className="muted small">No principals yet.</p>
          <p className="muted small">
            After someone signs in they appear here. Grant a role manually — belonging to
            an IdP group never auto-provisions access.
          </p>
        </div>
      )}
      {users.length > 0 && (
        <>
          <ul className="ns-member-list" data-testid="users-grant-list">
            {pageSlice.items.map((u) => (
              <li key={`${u.iss}|${u.sub}`} className="ns-member-row">
                <div className="ns-member-main">
                  <code className="ns-member-sub">{u.name || u.email || u.sub}</code>
                  <span className="muted small">
                    {u.email}
                    {' · '}
                    {u.role
                      ? profileRoleBadge({ role: u.role, pending: false })
                      : 'No role'}
                    {' · '}
                    {u.customPermissionCount} custom permission
                    {u.customPermissionCount === 1 ? '' : 's'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => openGrant(u)}
                >
                  Grant Access
                </button>
              </li>
            ))}
          </ul>
          {pageSlice.pageCount > 1 ? (
            <Pagination
              page={pageSlice.page}
              pageCount={pageSlice.pageCount}
              total={pageSlice.total}
              onPageChange={setPage}
              label="Grant access pagination"
            />
          ) : null}
        </>
      )}

      {grantOpen && (
        <form className="ns-member-form auth-panel-stack" onSubmit={onGrant}>
          <h3 className="ns-settings-subhead">Grant Access</h3>
          <DirectoryPicker
            kind="user"
            sub={targetSub}
            iss={targetIss}
            defaultIss={signedInIss}
            onChange={(next) => {
              setTargetSub(next.sub)
              setTargetIss(next.iss)
              setAdminFloorError(false)
            }}
          />
          <div className="ns-settings-grid">
            <label className="ns-settings-field">
              <span className="ns-settings-label">Role</span>
              <select
                value={grantRoleValue ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  const extras = extrasBeyondRole(
                    grantRoleValue,
                    grantPerms,
                    authz.rolePermissions,
                  )
                  setGrantRoleValue(next)
                  setGrantPerms(
                    selectGrantRolePermissions({
                      role: next,
                      rolePermissions: authz.rolePermissions,
                      extras,
                    }),
                  )
                  setAdminFloorError(false)
                }}
              >
                <option value="">No role change</option>
                {roleChoices.map((role) => (
                  <option key={role} value={role}>
                    {profileRoleBadge({ role, pending: false })}
                  </option>
                ))}
              </select>
            </label>
            <label className="ns-settings-field">
              <span className="ns-settings-label">
                Expires{grantRoleValue === 'auditor' ? ' (required for Auditor)' : ''}
              </span>
              <input
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                required
              />
            </label>
          </div>
          {grantRoleValue === 'auditor' && (
            <p
              className="flash flash-warn"
              role="status"
              data-testid="auditor-grant-hint"
            >
              Auditor grants always expire. The principal must present MFA on every
              request, can read across ACLs (including signature evidence on Audit), and
              cannot write, merge, delete, or sign.
            </p>
          )}
          {floorBlocksDemotion && (
            <p className="flash flash-warn" role="status">
              Remove is refused while two or fewer instance admins remain
              {adminCount > 0 ? ` (${adminCount} now)` : ''}. Grant a non-Admin role only when at least three Admins are listed.
            </p>
          )}
          <fieldset>
            <legend>Permissions (optional modify)</legend>
            <p className="muted small">
              Permissions included in the selected role are checked automatically. Add
              extras below if you need more than the role provides.
            </p>
            <div className="perm-multiselect perm-multiselect-compact">
              {authz.permissionCatalog.map((perm) => {
                const inRole = Boolean(
                  grantRoleValue &&
                    authz.rolePermissions?.[grantRoleValue]?.includes(perm),
                )
                return (
                  <label key={perm} className="radio-row">
                    <input
                      type="checkbox"
                      checked={grantPerms.includes(perm)}
                      disabled={inRole}
                      onChange={() => {
                        if (inRole) return
                        setGrantPerms((prev) => togglePermission(prev, perm))
                      }}
                    />
                    <code className="small">{perm}</code>
                    {inRole ? (
                      <span className="muted small"> (in role)</span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>
          <p className="muted small" data-testid="grant-access-reason-hint">
            Submitting opens the signing ceremony — the reason you enter there is bound to the
            electronic signature for this grant.
          </p>
          <div className="btn-row ns-settings-actions">
            <button
              className="btn primary"
              type="submit"
              disabled={busy || floorBlocksDemotion}
              aria-busy={busy || undefined}
            >
              {busy ? 'Granting…' : floorBlocksDemotion ? 'Remove blocked' : 'Grant'}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => setGrantOpen(false)}
            >
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

  async function onRevokeSessions(e: FormEvent) {
    e.preventDefault()
    const issuer = revokeIss.trim() || signedInIss.trim()
    if (!revokeSub.trim() || !issuer) {
      setError('Choose a user from directory search')
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
                Principals holding the Admin role. Grant or change the role under Users; the role cannot be taken from the last two admins.
                A Bootstrap mark means this Principal is on AUTHZ_BOOTSTRAP_ADMINS and receives the Admin role again on the next login.
                Instance admins manage the platform only — no namespace membership, repository data, or audit trail (separation of duties).
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
                  <UserRef
                    author={`${a.iss}|${a.sub}`}
                    name={a.name || a.email || a.sub}
                  />
                  <span className="muted small">
                    {a.email ? `${a.email} · ` : ''}
                    {a.sub}
                    {' · '}
                    {a.iss}
                  </span>
                </div>
                {a.bootstrap && <span className="ns-tag">bootstrap</span>}
                <span className="ns-tag ns-tag-accent">admin</span>
              </li>
            ))}
          </ul>
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
      setError('Choose a user from directory search')
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
                Delegate individual instance permissions to non-admins. Every grant needs a
                future expiry; a daily job revokes expired grants and writes an audit event.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.permissions.length === 1 ? '1 grant' : `${data.permissions.length} grants`}
            </p>
          </div>
          {data.permissions.length === 0 ? (
            <div className="grant-access-empty" role="status" data-testid="delegated-empty">
              <p className="muted small">No delegated grants.</p>
              <p className="muted small">
                Pick a principal, choose permissions, and set a required expiry below.
              </p>
            </div>
          ) : (
            <ul className="ns-member-list">
              {data.permissions.map((p) => {
                const tone = delegatedExpiryTone(p.expiresAt)
                return (
                  <li key={`${p.iss}\0${p.sub}`} className="ns-member-row">
                    <div className="ns-member-main">
                      <code className="ns-member-sub">{p.sub}</code>
                      <span className="muted small">
                        {p.iss}
                        {' · '}
                        {p.permissions.join(', ')}
                      </span>
                    </div>
                    <span
                      className={
                        tone === 'expired'
                          ? 'group-binding-chip group-binding-chip-warn'
                          : tone === 'soon'
                            ? 'group-binding-chip group-binding-chip-warn'
                            : 'group-binding-chip group-binding-chip-ok'
                      }
                      data-testid="delegated-expiry-chip"
                      data-expiry-tone={tone}
                      title={new Date(p.expiresAt).toLocaleString()}
                    >
                      {delegatedExpiryLabel(p.expiresAt)}
                    </span>
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
                )
              })}
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
                Expires (required)
                <input
                  type="datetime-local"
                  value={expiresLocal}
                  onChange={(e) => setExpiresLocal(e.target.value)}
                  disabled={busy}
                  required={permChecks.length > 0}
                />
              </label>
              <p className="muted small" data-testid="delegated-expiry-hint">
                Grants without a future expiry are rejected. Clearing permissions removes the
                grant immediately.
              </p>
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

type AuditHealthStatus = {
  readiness: {
    ok: boolean
    store: 'ok' | 'error'
    chain: 'ok' | 'broken' | 'acknowledged' | 'unverified'
    detail?: string
    events?: number
    verifiedAt?: string
    firstBreak?: { seq: number; reason: string }
  }
  /** Chain tip for IQP / change-control; null until the ledger has been verified. */
  chainTip?: { txid: number; root: string; verifiedAt?: string } | null
  /** Public half of AUDIT_EXPORT_PRIVATE_KEY (PEM); null when no signing key is configured. */
  exportPublicKey?: string | null
  ha: { attested: boolean; detail: string }
  currentOutage: {
    startedAt: number
    endedAt?: number
    check: string
    requestId: string
    paperProcedure: string
  } | null
  recentOutages: Array<{
    startedAt: number
    endedAt?: number
    check: string
    requestId: string
    paperProcedure: string
  }>
  verification?: {
    ok: boolean
    events: number
    verifiedAt: string
    firstBreak?: { seq: number; reason: string }
  }
  checkedAt?: string
}

type RegulatedConfigPayload = {
  config: {
    gxpStrict: true
    session: { idleSec: number; absoluteSec: number; cookieSecure: boolean }
    reason: { minLength: number; requiredActions: string[] }
    changeControl: {
      requiredActions: string[]
      alsoRequiredOn: string[]
      allocation: 'server'
    }
    signature: {
      requiredActions: string[]
      meaning: 'Approved'
      allocation: 'ceremony'
    }
    audit: { immudbHaAttested: boolean; verifyIntervalSec: number }
    backup: { targetConfigured: boolean }
    authz: { requireTraining: boolean }
  }
  digest: string
  recordedAt: string | null
  changedFromPrevious: boolean | null
}

function RegulatedConfigSection() {
  const status = useAsync(async (signal) => {
    try {
      const res = await fetch('/auth/admin/regulated-config', { signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json() as RegulatedConfigPayload
    } catch (err) {
      console.error('Failed to fetch regulated config:', err)
      return null
    }
  }, [])

  const data = status.kind === 'ok' ? status.data : null
  const cfg = data?.config
  const mutationClasses = cfg?.reason.requiredActions ?? []

  return (
    <section id="regulated-config" className="settings-section" aria-labelledby="regulated-config-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="regulated-config-heading">
            <Scale size={18} className="button-label-icon" aria-hidden="true" />
            Regulated config
          </h2>
          <p className="muted small">
            Effective GxP controls for this instance. Written to the audit trail at each start
            and whenever regulated settings change.
          </p>
        </div>
        {cfg ? (
          <span className="status-pill ok" role="status" aria-label="GxP strict: Always on">
            Always on
          </span>
        ) : null}
      </div>

      {status.kind === 'loading' && !data ? (
        <p className="muted small" aria-live="polite">
          Loading…
        </p>
      ) : null}

      {data && cfg ? (
        <dl className="ns-settings-facts" aria-label="Effective regulated configuration">
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Idle timeout</dt>
            <dd className="ns-settings-fact-value">{cfg.session.idleSec}s</dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Absolute timeout</dt>
            <dd className="ns-settings-fact-value">{cfg.session.absoluteSec}s</dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Cookie Secure</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span className={cfg.session.cookieSecure ? 'status-pill ok' : 'status-pill warn'}>
                {cfg.session.cookieSecure ? 'Yes' : 'No'}
              </span>
            </dd>
          </div>

          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Reason length</dt>
            <dd className="ns-settings-fact-value">min {cfg.reason.minLength}</dd>
          </div>
          <div className="ns-settings-fact ns-settings-fact-wide ns-settings-fact-stack">
            <dt className="ns-settings-fact-label">Mutations</dt>
            <dd className="ns-settings-fact-value">
              <p className="ns-settings-fact-note muted">
                {mutationClasses.length} classes require reason, change-control, and signature
              </p>
              {mutationClasses.length > 0 ? (
                <ul className="ns-settings-code-list" aria-label="Mutation classes">
                  {mutationClasses.map((action) => (
                    <li key={action}>
                      <code className="inline-code">{action}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </dd>
          </div>

          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">IMMUDB_HA</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span className={cfg.audit.immudbHaAttested ? 'status-pill ok' : 'status-pill warn'}>
                {cfg.audit.immudbHaAttested ? 'Attested' : 'Not attested'}
              </span>
            </dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Verify every</dt>
            <dd className="ns-settings-fact-value">{cfg.audit.verifyIntervalSec}s</dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Backup target</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span className={cfg.backup.targetConfigured ? 'status-pill ok' : 'status-pill warn'}>
                {cfg.backup.targetConfigured ? 'Configured' : 'Not configured'}
              </span>
            </dd>
          </div>

          <div className="ns-settings-fact ns-settings-fact-wide">
            <dt className="ns-settings-fact-label">Digest</dt>
            <dd className="ns-settings-fact-value">
              <code className="inline-code">{data.digest}</code>
            </dd>
          </div>
          {data.recordedAt ? (
            <div className="ns-settings-fact ns-settings-fact-wide">
              <dt className="ns-settings-fact-label">Recorded</dt>
              <dd className="ns-settings-fact-value">
                <span>{new Date(data.recordedAt).toLocaleString()}</span>
                {data.changedFromPrevious === true ? (
                  <span className="status-pill warn">Changed since previous start</span>
                ) : null}
                {data.changedFromPrevious === false ? (
                  <span className="status-pill neutral">Unchanged since previous start</span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {status.kind === 'ok' && !data ? (
        <p className="flash flash-warn" role="status">
          Could not load regulated configuration.
        </p>
      ) : null}
    </section>
  )
}

type ReleaseManifestStatus = {
  present: boolean
  path?: string
  releaseVersion?: string
  signatureValid: boolean | null
  match: boolean | null
  mismatches: string[]
  components: Record<string, { expected?: string; actual: string; version: string }> | null
  checkedAt: string | null
  reason?: string
}

function ReleaseManifestSection() {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const status = useAsync(async (signal) => {
    try {
      const res = await fetch('/auth/admin/release-manifest/status', { signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json() as ReleaseManifestStatus
    } catch (err) {
      console.error('Failed to fetch release manifest status:', err)
      return null
    }
  }, [])

  async function triggerCheck() {
    setChecking(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/auth/admin/release-manifest/check', { method: 'POST' })
      const data = await res.json() as ReleaseManifestStatus & { error?: string }
      if (!res.ok) {
        setError(data.error || 'Check failed')
      } else {
        setSuccess(data.match ? 'Release manifest matches this build' : 'Release manifest mismatch — see details')
        status.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setChecking(false)
    }
  }

  const data = status.kind === 'ok' ? status.data : null
  const resultTone = data?.match
    ? 'ok'
    : data?.present === false || data?.match === false
      ? 'warn'
      : 'neutral'
  const resultLabel = data?.match
    ? 'Match'
    : data?.present
      ? 'Mismatch'
      : data
        ? 'Missing or invalid'
        : null

  return (
    <section id="release-manifest" className="settings-section" aria-labelledby="release-manifest-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="release-manifest-heading">
            <Package size={18} className="button-label-icon" aria-hidden="true" />
            Release manifest
          </h2>
          <p className="muted small">
            Signed digests of IdP configuration, search index, and custom verifiers verified at start.
            A mismatch is audited and shown here; it does not refuse boot by itself.
          </p>
        </div>
        {resultLabel ? (
          <span
            className={`status-pill ${resultTone}`}
            role="status"
            aria-label={`Release manifest: ${resultLabel}${data?.releaseVersion ? `, release ${data.releaseVersion}` : ''}`}
          >
            {resultLabel}
            {data?.releaseVersion ? ` · ${data.releaseVersion}` : ''}
          </span>
        ) : null}
      </div>

      {status.kind === 'loading' && !data ? (
        <p className="muted small" aria-live="polite">
          Loading…
        </p>
      ) : null}

      {data ? (
        <dl className="ns-settings-facts" aria-label="Release manifest status">
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Signature</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span
                className={
                  data.signatureValid === true
                    ? 'status-pill ok'
                    : data.signatureValid === false
                      ? 'status-pill bad'
                      : 'status-pill neutral'
                }
              >
                {data.signatureValid === true
                  ? 'Valid'
                  : data.signatureValid === false
                    ? 'Invalid'
                    : 'Not checked'}
              </span>
            </dd>
          </div>
          {data.checkedAt ? (
            <div className="ns-settings-fact">
              <dt className="ns-settings-fact-label">Checked</dt>
              <dd className="ns-settings-fact-value">
                {new Date(data.checkedAt).toLocaleString()}
              </dd>
            </div>
          ) : null}
          {data.reason ? (
            <div className="ns-settings-fact ns-settings-fact-wide">
              <dt className="ns-settings-fact-label">Detail</dt>
              <dd className="ns-settings-fact-value">{data.reason}</dd>
            </div>
          ) : null}
          {data.mismatches.length > 0 ? (
            <div className="ns-settings-fact ns-settings-fact-wide">
              <dt className="ns-settings-fact-label">Mismatches</dt>
              <dd className="ns-settings-fact-value">
                {data.mismatches.map((m) => (
                  <code key={m} className="inline-code">
                    {m}
                  </code>
                ))}
              </dd>
            </div>
          ) : null}
          {data.components ? (
            <div className="ns-settings-fact ns-settings-fact-wide">
              <dt className="ns-settings-fact-label">Components</dt>
              <dd className="ns-settings-fact-value">
                {Object.entries(data.components).map(([id, c]) => {
                  const ok = !(c.expected && c.expected !== c.actual)
                  return (
                    <span key={id} className="ns-tag ns-tag-muted">
                      <code className="inline-code">{id}</code>
                      <span className="muted">v{c.version}</span>
                      <span className={ok ? 'status-pill ok' : 'status-pill warn'}>
                        {ok ? 'ok' : 'digest differs'}
                      </span>
                    </span>
                  )
                })}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="btn-row ns-settings-actions">
        <button
          className="btn primary"
          type="button"
          onClick={triggerCheck}
          disabled={checking}
        >
          <Package size={14} aria-hidden="true" className="button-label-icon" />
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="flash flash-success" role="status">
          {success}
        </p>
      ) : null}
    </section>
  )
}

function AuditHealthSection() {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const status = useAsync(async (signal) => {
    try {
      const res = await fetch('/auth/admin/audit-health/status', { signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json() as AuditHealthStatus
    } catch (err) {
      console.error('Failed to fetch audit health status:', err)
      return null
    }
  }, [])

  async function triggerCheck() {
    setChecking(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/auth/admin/audit-health/check', { method: 'POST' })
      const data = await res.json() as AuditHealthStatus & { error?: string }
      if (!res.ok) {
        setError(data.error || 'Check failed')
      } else {
        setSuccess(data.readiness.ok ? 'Audit store healthy' : 'Audit store degraded — incident recorded')
        status.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setChecking(false)
    }
  }

  const data = status.kind === 'ok' ? status.data : null

  return (
    <section id="audit-health" className="settings-section" aria-labelledby="audit-health-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="audit-health-heading">
            <HeartPulse size={18} className="button-label-icon" aria-hidden="true" />
            Audit health
          </h2>
          <p className="muted small">
            Probe immudb availability, confirm HA attestation, and review audit-outage incidents.
            When the audit store is down, mutations are refused and reads continue.
          </p>
        </div>
      </div>

      {data && (
        <div className="ns-settings-grid">
          <div className="ns-settings-field">
            <span className="ns-settings-label">Store</span>
            <p className={data.readiness.store === 'ok' ? 'flash flash-success' : 'flash flash-warning'}>
              {data.readiness.store === 'ok' ? (
                <><ActionCheck size={14} aria-hidden="true" /> Available</>
              ) : (
                <><ActionX size={14} aria-hidden="true" /> Unavailable{data.readiness.detail ? `: ${data.readiness.detail}` : ''}</>
              )}
            </p>
          </div>

          <div className="ns-settings-field">
            <span className="ns-settings-label">Chain</span>
            <p className={data.readiness.chain === 'broken' ? 'flash flash-warning' : 'muted small'}>
              {data.readiness.chain}
              {data.readiness.firstBreak ? ` — ${data.readiness.firstBreak.reason}` : ''}
            </p>
          </div>

          <div className="ns-settings-field" data-testid="audit-chain-tip">
            <span className="ns-settings-label">Chain tip (IQP)</span>
            {data.chainTip ? (
              <>
                <p className="small">
                  txid <code className="inline-code" data-testid="audit-chain-tip-txid">{data.chainTip.txid}</code>
                  {' · '}
                  root <code className="inline-code" data-testid="audit-chain-tip-root">{data.chainTip.root || '(empty ledger)'}</code>
                </p>
                <p className="muted small">
                  File with the IQP / change-control record at install; re-file after a restore.
                  {data.chainTip.verifiedAt
                    ? ` Verified ${new Date(data.chainTip.verifiedAt).toLocaleString()}.`
                    : ''}
                </p>
              </>
            ) : (
              <p className="flash flash-warning">
                Not available — the ledger has not been verified yet. Run “Check now”.
              </p>
            )}
          </div>

          <div className="ns-settings-field" data-testid="audit-export-public-key">
            <span className="ns-settings-label">Export public key</span>
            {data.exportPublicKey ? (
              <>
                <pre
                  className="mono small"
                  tabIndex={0}
                  aria-label="Audit export signing public key (PEM)"
                  style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                  data-testid="audit-export-public-key-pem"
                >
                  {data.exportPublicKey.trim()}
                </pre>
                <p className="muted small">
                  Verifies signed audit bundles. File alongside the genesis root in IQP.
                </p>
              </>
            ) : (
              <p className="flash flash-warning">
                Not configured — set <code className="inline-code">AUDIT_EXPORT_PRIVATE_KEY</code>; PDF and bundle exports are refused until then.
              </p>
            )}
          </div>

          <div className="ns-settings-field">
            <span className="ns-settings-label">HA attestation</span>
            <p className={data.ha.attested ? 'flash flash-success' : 'flash flash-warning'}>
              {data.ha.attested ? (
                <><ActionCheck size={14} aria-hidden="true" /> IMMUDB_HA=true</>
              ) : (
                <><ActionX size={14} aria-hidden="true" /> Not attested</>
              )}
            </p>
            <p className="muted small">{data.ha.detail}</p>
          </div>

          <div className="ns-settings-field">
            <span className="ns-settings-label">Open outage</span>
            {data.currentOutage ? (
              <p className="flash flash-warning">
                Since {new Date(data.currentOutage.startedAt).toLocaleString()}
                {' · '}
                check <code className="inline-code">{data.currentOutage.check}</code>
                {' · '}
                <code className="inline-code">{data.currentOutage.paperProcedure}</code>
              </p>
            ) : (
              <p className="flash flash-success"><ActionCheck size={14} aria-hidden="true" /> None</p>
            )}
          </div>

          {data.recentOutages.length > 0 && (
            <div className="ns-settings-field">
              <span className="ns-settings-label">Recent incidents</span>
              <ul className="muted small" style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {data.recentOutages.slice(0, 5).map((o) => (
                  <li key={`${o.startedAt}-${o.requestId}`}>
                    {new Date(o.startedAt).toLocaleString()}
                    {' · '}
                    {o.check}
                    {o.endedAt ? ` · closed ${new Date(o.endedAt).toLocaleString()}` : ' · open'}
                  </li>
                ))}
              </ul>
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
          <HeartPulse size={14} aria-hidden="true" className="button-label-icon" />
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {success && <p className="flash flash-success" role="status">{success}</p>}
    </section>
  )
}

type IdpBaselineLastCheck = {
  id: number
  checkedAt: string
  checkedBy: string
  mfaAvailable: boolean
  claimsFound: { acr?: string; amr: string[] } | null
  error: string | null
}

function IdpBaselineStatus({ lastCheck }: { lastCheck: IdpBaselineLastCheck }) {
  const profiles = usePrincipalProfiles([lastCheck.checkedBy])
  const amr = lastCheck.claimsFound?.amr ?? []

  return (
    <dl className="ns-settings-facts">
      <div className="ns-settings-fact ns-settings-fact-wide">
        <dt className="ns-settings-fact-label">Last check</dt>
        <dd className="ns-settings-fact-value">
          <span>{new Date(lastCheck.checkedAt).toLocaleString()}</span>
          <span className="muted">by</span>
          <UserRef author={lastCheck.checkedBy} profiles={profiles} />
        </dd>
      </div>

      <div className="ns-settings-fact">
        <dt className="ns-settings-fact-label">MFA</dt>
        <dd className="ns-settings-fact-value" role="status">
          <span className={lastCheck.mfaAvailable ? 'status-pill ok' : 'status-pill warn'}>
            {lastCheck.mfaAvailable ? 'Available' : 'Not available'}
          </span>
        </dd>
      </div>

      {lastCheck.claimsFound && (
        <div className="ns-settings-fact">
          <dt className="ns-settings-fact-label">Claims</dt>
          <dd className="ns-settings-fact-value">
            <span className="ns-tag ns-tag-muted">
              acr {lastCheck.claimsFound.acr || 'none'}
            </span>
            <span className="ns-tag ns-tag-muted">
              amr {amr.length > 0 ? amr.join(', ') : 'none'}
            </span>
          </dd>
        </div>
      )}

      {lastCheck.error && (
        <div className="ns-settings-fact ns-settings-fact-wide">
          <dt className="ns-settings-fact-label">Error</dt>
          <dd className="ns-settings-fact-value">
            <p className="flash flash-warn" role="status">{lastCheck.error}</p>
          </dd>
        </div>
      )}
    </dl>
  )
}

function IdpBaselineSection() {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = useAsync(async (signal) => {
    const res = await fetch('/auth/admin/idp-baseline/status', { signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json() as {
      lastCheck: IdpBaselineLastCheck | null
    }
  }, [])

  async function triggerCheck() {
    setChecking(true)
    setError(null)

    try {
      const res = await fetch('/auth/admin/idp-baseline/check', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Check failed')
      } else {
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

      {status.kind === 'loading' && (
        <p role="status" aria-live="polite">Loading baseline status…</p>
      )}

      {status.kind === 'error' && (
        <div className="flash flash-error" role="alert">
          <p>Could not load IdP baseline status.</p>
          <button type="button" className="btn ghost" onClick={() => status.reload()}>
            Try again
          </button>
        </div>
      )}

      {status.kind === 'ok' && status.data && (
        status.data.lastCheck ? (
          <IdpBaselineStatus lastCheck={status.data.lastCheck} />
        ) : (
          <div className="empty-state" role="status">
            <span className="empty-state-icon" aria-hidden="true" />
            <p className="muted">No baseline checks have been performed yet.</p>
            <p className="muted small">Run Check Now to record whether the IdP presents MFA claims.</p>
          </div>
        )
      )}

      {error && <p className="flash flash-error" role="alert">{error}</p>}

      <div className="btn-row ns-settings-actions">
        <button
          className="btn primary"
          type="button"
          onClick={() => void triggerCheck()}
          disabled={checking}
          aria-busy={checking || undefined}
        >
          <ShieldAlert size={14} aria-hidden="true" className="button-label-icon" />
          {checking ? 'Checking…' : 'Check Now'}
        </button>
      </div>
    </section>
  )
}
