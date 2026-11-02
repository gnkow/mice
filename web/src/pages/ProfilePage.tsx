import { useEffect, useState } from 'react'
import { SectionNav } from '../components/SectionNav'
import { useFavorites } from '../lib/favorites'
import { Bell, KeyRound, Star, Sun, UserRound, ShieldCheck, Check } from 'lucide-react'
import { fetchAuthMe, fetchAuthzMe } from '../lib/auth'
import { useAsync } from '../hooks/useAsync'
import { loadAppearance, saveAppearance, subscribeAppearance, type Appearance } from '../lib/appearance'
import { NotificationSettingsPage } from './NotificationSettingsPage'
import { ProfileFavoritesSection } from '../components/ProfileFavoritesSection'
import { ProfileCliAccessSection } from '../components/ProfileCliAccessSection'
import type { InstancePermission } from '../lib/authzContract'

const PERMISSION_INFO: Record<InstancePermission, { label: string; description: string }> = {
  create_namespace: {
    label: 'Create namespace',
    description: 'Create new namespaces and become their owner',
  },
  view_audit: {
    label: 'View audit',
    description: 'Access audit logs and security events',
  },
  view_lineage: {
    label: 'View lineage',
    description: 'View data lineage and provenance reports',
  },
  manage_own_tokens: {
    label: 'Manage own tokens',
    description: 'Create and manage personal access tokens',
  },
  cli_device_approve: {
    label: 'Approve CLI devices',
    description: 'Approve CLI device authorization requests',
  },
  session_create: {
    label: 'Create sessions',
    description: 'Create workspace sessions',
  },
  session_connect: {
    label: 'Connect to sessions',
    description: 'Connect to workspace sessions',
  },
  session_admin: {
    label: 'Administer sessions',
    description: 'Manage all workspace sessions (admin-level access)',
  },
}

export function ProfilePage() {
  const me = useAsync(() => fetchAuthMe(), [])
  const authz = useAsync(() => fetchAuthzMe(), [])
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
                  {authz.kind === 'ok' && authz.data?.instanceAdmin && (
                    <span className="pill" style={{ 
                      backgroundColor: 'var(--color-accent)', 
                      color: 'white',
                      fontWeight: '600',
                      letterSpacing: '0.02em'
                    }}>
                      Admin
                    </span>
                  )}
                  {authz.kind === 'ok' && authz.data?.pending && (
                    <span className="pill" style={{ 
                      backgroundColor: 'var(--color-warn)', 
                      color: 'white',
                      fontWeight: '600',
                      letterSpacing: '0.02em'
                    }}>
                      Pending
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
                  {authz.kind === 'ok' && authz.data && (
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <span className="muted" style={{ minWidth: '4rem' }}>Role:</span>
                      <span style={{ fontWeight: '500' }}>
                        {authz.data.pending 
                          ? 'Pending approval' 
                          : authz.data.instanceAdmin 
                            ? 'Instance Administrator' 
                            : Object.values(authz.data.permissions).some(v => v)
                              ? 'User with delegated permissions'
                              : 'User'}
                      </span>
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
            {authz.data.pending && (
              <div className="flash flash-warn" role="alert">
                <p><strong>Access pending</strong></p>
                <p>Your account is awaiting approval from an administrator. You will be notified when access is granted.</p>
              </div>
            )}
            
            {!authz.data.pending && (
              <div className="ns-settings-subsection">
                {authz.data.instanceAdmin && (
                  <p className="muted small" style={{ marginBottom: '1rem' }}>
                    As an <strong>Instance Administrator</strong>, you have all permissions listed below.
                  </p>
                )}
                
                <h3 className="muted small" style={{ marginBottom: '0.75rem' }}>Instance permissions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {Object.entries(PERMISSION_INFO).map(([perm, info]) => {
                    const hasPermission = authz.data.instanceAdmin || authz.data.permissions[perm as InstancePermission]
                    return (
                      <div 
                        key={perm}
                        style={{ 
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          padding: '0.75rem',
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
                          marginTop: '0.125rem',
                        }}>
                          {hasPermission && (
                            <Check size={14} color="white" strokeWidth={3} />
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ 
                            fontWeight: hasPermission ? '600' : '500',
                            marginBottom: '0.25rem',
                            color: hasPermission ? 'var(--color-fg-default)' : 'var(--color-fg-muted)'
                          }}>
                            {info.label}
                          </div>
                          <div className="muted small">
                            {info.description}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                
                {!authz.data.instanceAdmin && !Object.values(authz.data.permissions).some(v => v) && (
                  <p className="muted small" style={{ marginTop: '1rem' }}>
                    {authz.data.hasAnyGrant 
                      ? 'You have access to specific namespaces or repositories.' 
                      : 'Contact an administrator to request permissions.'}
                  </p>
                )}
              </div>
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
