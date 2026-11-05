import { type FormEvent, useEffect, useState } from 'react'
import { SectionNav } from '../components/SectionNav'
import { useFavorites } from '../lib/favorites'
import { Bell, KeyRound, Star, Sun, UserRound, ShieldCheck, Check } from 'lucide-react'
import { fetchAuthMe, fetchAuthzMe } from '../lib/auth'
import { useAsync } from '../hooks/useAsync'
import { loadAppearance, saveAppearance, subscribeAppearance, type Appearance } from '../lib/appearance'
import { NotificationSettingsPage } from './NotificationSettingsPage'
import { ProfileFavoritesSection } from '../components/ProfileFavoritesSection'
import { ProfileCliAccessSection } from '../components/ProfileCliAccessSection'
import { profileRoleBadge, upgradeableRoles } from '../lib/profileRoleBadge'
import {
  REQUESTABLE_ROLES,
  buildAccessRequestPayload,
  togglePermission,
  type RequestAccessFormState,
  type RequestableRoleId,
} from '../lib/requestAccessForm'
import { fetchOwnAccessRequest, submitAccessRequest } from '../lib/authzApi'

export function ProfilePage() {
  const me = useAsync(() => fetchAuthMe(), [])
  const authz = useAsync(() => fetchAuthzMe(), [])
  const ownRequest = useAsync((signal) => fetchOwnAccessRequest(signal), [])
  const [appearance, setAppearance] = useState(loadAppearance)
  useEffect(() => subscribeAppearance(() => setAppearance(loadAppearance())), [])

  function update(patch: Partial<Appearance>) {
    saveAppearance({ ...loadAppearance(), ...patch })
  }

  const favorites = useFavorites()
  const groups = [
    { title: 'Account', items: [
      { id: 'profile-account', label: 'Account', Icon: UserRound },
      { id: 'profile-permissions', label: 'Permissions', Icon: ShieldCheck },
      { id: 'profile-appearance', label: 'Appearance', Icon: Sun },
    ] },
    { title: 'Personal', items: [
      { id: 'favorites', label: 'Favorites', Icon: Star, badge: favorites.ready ? favorites.items.length : undefined },
      { id: 'notifications', label: 'Notifications', Icon: Bell },
    ] },
    { title: 'Access', items: [
      { id: 'access-management', label: 'Sessions', Icon: KeyRound },
    ] },
  ]

  const role = authz.kind === 'ok' && authz.data ? authz.data.role : null
  const pending = authz.kind === 'ok' && authz.data ? authz.data.pending : false
  const badge = authz.kind === 'ok' && authz.data
    ? profileRoleBadge({ role: authz.data.role, pending: authz.data.pending })
    : null
  const upgrades = upgradeableRoles(role)
  const pendingRequest =
    ownRequest.kind === 'ok' ? ownRequest.data.request : null

  return <main className="page wide">
    <div className="page-head">
      <div><h1><UserRound size={24} className="button-label-icon" aria-hidden="true" />Profile</h1>
        <p className="lede">Your account, appearance, CLI access, and notification preferences.</p></div>
    </div>
    <div className="profile-layout">
    <SectionNav label="Profile sections" groups={groups} />
    <div className="ns-settings profile-sections">
      <section className="settings-section" id="profile-account" aria-labelledby="profile-account-heading">
        <h2 id="profile-account-heading"><UserRound size={18} className="button-label-icon" aria-hidden="true" />Account</h2>
        {me.kind === 'loading' && <p role="status">Loading account...</p>}
        {me.kind === 'error' && <p className="flash flash-error" role="alert">Could not load your account.</p>}
        {me.kind === 'ok' && me.data.authenticated && (
          <div className="ns-settings-subsection">
            <div className="profile-account-card">
              <div className="profile-account-avatar" aria-hidden="true">
                {me.data.user.name.charAt(0).toUpperCase()}
              </div>
              <div className="profile-account-body">
                <div className="profile-account-title-row">
                  <h3>{me.data.user.name}</h3>
                  {badge && (
                    <span
                      className={`pill role-badge${pending ? ' is-pending' : ''}`}
                      role="status"
                    >
                      {badge}
                    </span>
                  )}
                </div>
                <p className="profile-account-email">{me.data.user.email}</p>
                <div className="profile-account-meta">
                  <div className="profile-account-meta-row">
                    <span className="profile-account-meta-label">Provider:</span>
                    <span className="profile-account-meta-value">SSO</span>
                  </div>
                  {badge && (
                    <div className="profile-account-meta-row">
                      <span className="profile-account-meta-label">Role:</span>
                      <span className="profile-account-meta-value">{badge}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="muted small auth-panel-stack">
              Your identity and commit author are managed by your SSO provider.
            </p>
          </div>
        )}
      </section>
      <section className="settings-section" id="profile-permissions" aria-labelledby="profile-permissions-heading">
        <h2 id="profile-permissions-heading"><ShieldCheck size={18} className="button-label-icon" aria-hidden="true" />Permissions</h2>
        {authz.kind === 'loading' && <p role="status">Loading permissions...</p>}
        {authz.kind === 'error' && <p className="flash flash-error" role="alert">Could not load permissions.</p>}
        {authz.kind === 'ok' && authz.data && (
          <>
            {pending && (
              <div className="flash flash-warn" role="status">
                <p><strong>Access pending</strong></p>
                <p>Your account is awaiting a formal role. You will gain access once a manager or admin approves your request.</p>
              </div>
            )}

            {pendingRequest && (
              <div className="flash flash-warn" role="status">
                <p><strong>Request pending</strong></p>
                <p>
                  {pendingRequest.requestedRole
                    ? `Role upgrade to ${profileRoleBadge({ role: pendingRequest.requestedRole, pending: false })} is awaiting review.`
                    : 'Your additional permission request is awaiting review.'}
                </p>
              </div>
            )}

            {!pending && (
              <div className="ns-settings-subsection">
                <h3 className="muted small">
                  Instance permissions ({authz.data.effectivePermissions.length} granted)
                </h3>
                <div className="perm-list" role="list">
                  {authz.data.permissionCatalog.map((perm) => {
                    const hasPermission = authz.data.effectivePermissions.includes(perm)
                    return (
                      <div
                        key={perm}
                        className={`perm-row${hasPermission ? ' is-granted' : ''}`}
                        role="listitem"
                        aria-label={`${perm}: ${hasPermission ? 'granted' : 'not granted'}`}
                      >
                        <div className="perm-check" aria-hidden="true">
                          {hasPermission && (
                            <Check size={14} color="white" strokeWidth={3} />
                          )}
                        </div>
                        <code>{perm}</code>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!pending && !pendingRequest && (
              <RequestAdditionalSection
                upgrades={upgrades}
                permissionCatalog={authz.data.permissionCatalog.filter(
                  (p) => !authz.data.effectivePermissions.includes(p),
                )}
                onSubmitted={() => ownRequest.reload()}
              />
            )}
          </>
        )}
      </section>
      <section className="settings-section" id="profile-appearance" aria-labelledby="profile-appearance-heading">
        <h2 id="profile-appearance-heading"><Sun size={18} className="button-label-icon" aria-hidden="true" />Appearance</h2>
        <p className="muted small">Changes apply immediately and are saved in this browser.</p>
        <div className="ns-settings-grid">
          <fieldset className="appearance-fieldset"><legend>Theme</legend>
            {(['light', 'dark', 'system'] as const).map(value => <label key={value}>
              <input type="radio" name="color-mode" checked={appearance.colorMode === value} onChange={() => update({ colorMode: value })} />
              {value === 'light' ? 'Light' : value === 'dark' ? 'Dark' : 'System'}
            </label>)}
          </fieldset>
          <fieldset className="appearance-fieldset"><legend>Diff colors</legend>
            {(['default', 'colorblind'] as const).map(value => <label key={value}>
              <input type="radio" name="diff-palette" checked={appearance.diffPalette === value} onChange={() => update({ diffPalette: value })} />
              {value === 'default' ? 'Default' : 'Colorblind'}
            </label>)}
          </fieldset>
        </div>
      </section>
      <ProfileFavoritesSection />
      <NotificationSettingsPage embedded />
      <ProfileCliAccessSection />
    </div>
    </div>
  </main>
}

function RequestAdditionalSection({
  upgrades,
  permissionCatalog,
  onSubmitted,
}: {
  upgrades: RequestableRoleId[]
  permissionCatalog: string[]
  onSubmitted: () => void
}) {
  const canUpgrade = upgrades.length > 0
  const canRequestPerms = permissionCatalog.length > 0
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<RequestAccessFormState>({
    mode: canUpgrade ? 'role' : 'custom',
    role: upgrades[0] ?? 'user',
    permissions: [],
    message: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!canUpgrade && !canRequestPerms) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const built = buildAccessRequestPayload(form)
    if (!built.ok) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitAccessRequest(built.payload)
      setOpen(false)
      setForm((f) => ({ ...f, message: '', permissions: [] }))
      onSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const upgradeOptions = REQUESTABLE_ROLES.filter((r) => upgrades.includes(r.id))

  return (
    <div className="ns-settings-subsection auth-panel-stack">
      <h3>Request additional access</h3>
      <p className="muted small">
        Ask for a role upgrade or specific permissions beyond your current role.
      </p>
      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Request additional permissions
        </button>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          {(canUpgrade || canRequestPerms) && (
            <fieldset>
              <legend>Request type</legend>
              {canUpgrade && (
                <label className="radio-row">
                  <input
                    type="radio"
                    name="addl-mode"
                    checked={form.mode === 'role'}
                    onChange={() => setForm((f) => ({ ...f, mode: 'role' }))}
                  />
                  Role upgrade
                </label>
              )}
              {canRequestPerms && (
                <label className="radio-row">
                  <input
                    type="radio"
                    name="addl-mode"
                    checked={form.mode === 'custom'}
                    onChange={() => setForm((f) => ({ ...f, mode: 'custom' }))}
                  />
                  Specific permissions
                </label>
              )}
            </fieldset>
          )}

          {form.mode === 'role' && canUpgrade ? (
            <fieldset>
              <legend>Role</legend>
              {upgradeOptions.map((r) => (
                <label key={r.id} className="radio-row">
                  <input
                    type="radio"
                    name="addl-role"
                    checked={form.role === r.id}
                    onChange={() => setForm((f) => ({ ...f, role: r.id }))}
                  />
                  <span>
                    <strong>{r.label}</strong>
                    <span className="muted small role-option-desc">
                      {r.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset>
              <legend>Permissions</legend>
              <div className="perm-multiselect">
                {permissionCatalog.map((perm) => (
                  <label key={perm} className="radio-row">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(perm)}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          permissions: togglePermission(f.permissions, perm),
                        }))
                      }
                    />
                    <code className="small">{perm}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label htmlFor="profile-addl-justification">
            Justification (required)
            <textarea
              id="profile-addl-justification"
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={3}
              placeholder="Why you need this access"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'profile-addl-error' : undefined}
            />
          </label>
          {error && (
            <p id="profile-addl-error" className="flash flash-error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-row">
            <button
              className="btn primary"
              type="submit"
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
