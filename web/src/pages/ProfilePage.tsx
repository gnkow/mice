import { useEffect, useState } from 'react'
import { Sun, UserRound } from 'lucide-react'
import { fetchAuthMe } from '../lib/auth'
import { useAsync } from '../hooks/useAsync'
import { loadAppearance, saveAppearance, subscribeAppearance, type Appearance } from '../lib/appearance'
import { NotificationSettingsPage } from './NotificationSettingsPage'
import { ProfileTokensSection } from '../components/ProfileTokensSection'

export function ProfilePage() {
  const me = useAsync(() => fetchAuthMe(), [])
  const [appearance, setAppearance] = useState(loadAppearance)
  useEffect(() => subscribeAppearance(() => setAppearance(loadAppearance())), [])

  function update(patch: Partial<Appearance>) {
    saveAppearance({ ...loadAppearance(), ...patch })
  }

  return <main className="page wide">
    <div className="page-head">
      <div><h1><UserRound size={24} className="button-label-icon" aria-hidden="true" />Profile</h1>
        <p className="lede">Your account, appearance, CLI tokens, and notification preferences.</p></div>
    </div>
    <div className="ns-settings">
      <section className="settings-section" aria-labelledby="profile-account-heading">
        <h2 id="profile-account-heading">Account</h2>
        {me.kind === 'loading' && <p role="status">Loading account...</p>}
        {me.kind === 'error' && <p className="flash flash-error" role="alert">Could not load your account.</p>}
        {me.kind === 'ok' && me.data.authenticated && <p>Signed as <strong>{me.data.user.name}</strong><br />{me.data.user.email}</p>}
        <p className="muted small">Your identity and commit author are managed by your SSO provider.</p>
      </section>
      <section className="settings-section" aria-labelledby="profile-appearance-heading">
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
      <ProfileTokensSection />
      <NotificationSettingsPage embedded />
    </div>
  </main>
}
