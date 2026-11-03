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
            <div style={{ 
              display: 'flex',
              gap: '1rem',
              padding: '1rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.375rem',
              backgroundColor: 'var(--color-canvas-subtle)',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-accent)',
                color: 'white',
                fontSize: '1.5rem',
                fontWeight: '600',
                flexShrink: 0,
              }}>
                {me.data.user.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600' }}>
                    {me.data.user.name}
                  </h3>
                  {badge && (
                    <span className="pill" style={{ 
                      backgroundColor: pending ? 'var(--color-warn)' : 'var(--color-accent)', 
                      color: 'white',
                      fontWeight: '600',
                      letterSpacing: '0.02em'
                    }}>
                      {badge}
                    </span>
                  )}
                </div>
                <p style={{ margin: '0 0 0.75rem 0', color: 'var(--color-fg-muted)' }}>
                  {me.data.user.email}
                </p>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '0.5rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <span className="muted" style={{ minWidth: '4rem' }}>Provider:</span>
                    <span style={{ fontWeight: '500' }}>SSO</span>
                  </div>
                  {badge && (
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <span className="muted" style={{ minWidth: '4rem' }}>Role:</span>
                      <span style={{ fontWeight: '500' }}>{badge}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="muted small" style={{ marginTop: '0.75rem' }}>
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
                <h3 className="muted small" style={{ marginBottom: '0.75rem' }}>
                  Instance permissions ({authz.data.effectivePermissions.length} granted)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '24rem', overflow: 'auto' }}>
                  {authz.data.permissionCatalog.map((perm) => {
                    const hasPermission = authz.data.effectivePermissions.includes(perm)
                    return (
                      <div
                        key={perm}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.5rem 0.75rem',
                          border: '1px solid var(--color-border)',
                          borderRadius: '0.375rem',
                          backgroundColor: hasPermission ? 'var(--color-canvas-subtle)' : 'transparent',
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '20px',
                          height: '20px',
                          borderRadius: '0.25rem',
                          border: hasPermission ? 'none' : '2px solid var(--color-border)',
                          backgroundColor: hasPermission ? 'var(--color-accent)' : 'transparent',
                          flexShrink: 0,
                        }}>
                          {hasPermission && (
                            <Check size={14} color="white" strokeWidth={3} />
                          )}
                        </div>
                        <code style={{
                          fontWeight: hasPermission ? '600' : '500',
                          color: hasPermission ? 'var(--color-fg-default)' : 'var(--color-fg-muted)',
                        }}>
                          {perm}
                        </code>
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
    <div className="ns-settings-subsection" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Request additional access</h3>
      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
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
                    <span className="muted small" style={{ display: 'block' }}>
                      {r.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset>
              <legend>Permissions</legend>
              <div
                className="perm-multiselect"
                style={{
                  maxHeight: '12rem',
                  overflow: 'auto',
                  border: '1px solid var(--color-border)',
                  borderRadius: '0.375rem',
                  padding: '0.5rem',
                }}
              >
                {permissionCatalog.map((perm) => (
                  <label key={perm} className="radio-row" style={{ display: 'flex', gap: '0.5rem' }}>
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

          <label>
            Justification (required)
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={3}
              placeholder="Why you need this access"
              required
            />
          </label>
          <div className="btn-row">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit request'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="flash flash-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
