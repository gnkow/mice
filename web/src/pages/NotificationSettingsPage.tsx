import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, BellOff, Download, Globe, Mail, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  decodeVapidKey, effectiveResourceMode, fetchNotificationSettings, notificationCategories, registerPushSubscription,
  removePushSubscription, resourceOverrideError, saveNotificationSettings, subscribeNotificationsChanged,
  type CategoryPreference, type NotificationPreferences, type NotificationResource, type NotificationSettings,
} from '../lib/notifications'

export function NotificationSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const [settings, setSettings] = useState<NotificationSettings>()
  const [form, setForm] = useState<NotificationPreferences>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => browserPushSupported() ? Notification.permission : 'unsupported')
  const [error, setError] = useState('')
  const [pushError, setPushError] = useState('')
  const [status, setStatus] = useState('')
  const [remoteChanged, setRemoteChanged] = useState(false)
  const [draft, setDraft] = useState<NotificationResource>({})
  const [mode, setMode] = useState<'watch' | 'mute'>('mute')
  const dirty = useRef(false)
  const saving = useRef(false)
  const pushSupported = browserPushSupported()

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    try {
      const data = await fetchNotificationSettings(signal)
      if (signal?.aborted) return
      if (background && dirty.current) { setRemoteChanged(true); return }
      setSettings(data)
      setForm(data.preferences)
      dirty.current = false
      setRemoteChanged(false)
      setError('')
    } catch (err) {
      if (!signal?.aborted) setError(message(err))
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal) })
    if (pushSupported) {
      void navigator.serviceWorker.getRegistration('/').then(async registration => {
        const subscription = await registration?.pushManager.getSubscription()
        if (!controller.signal.aborted) setSubscribed(!!subscription)
      }).catch(err => { if (!controller.signal.aborted) setPushError(message(err)) })
    }
    const unsubscribe = subscribeNotificationsChanged(() => {
      if (saving.current) return
      if (dirty.current) setRemoteChanged(true)
      else void load(controller.signal, true)
    })
    return () => { controller.abort(); unsubscribe() }
  }, [load, pushSupported])

  function update(next: NotificationPreferences) {
    dirty.current = true
    setStatus('')
    setForm(next)
  }
  function category(key: string, channel: keyof CategoryPreference, value: boolean) {
    if (!form) return
    const previous = form.categories[key] || { enabled: false, toast: false, email: false, push: false }
    update({ ...form, categories: { ...form.categories, [key]: { ...previous, [channel]: value } } })
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    try { new Intl.DateTimeFormat('en', { timeZone: form.timezone }).format() }
    catch { setError('Enter a valid IANA timezone, such as Europe/Berlin or UTC.'); return }
    setBusy(true)
    saving.current = true
    setError('')
    setStatus('')
    try {
      const data = await saveNotificationSettings(form)
      setSettings(data)
      setForm(data.preferences)
      dirty.current = false
      setRemoteChanged(false)
      setStatus('Notification preferences saved.')
    } catch (err) { setError(message(err)) }
    finally { setBusy(false); saving.current = false }
  }
  function addOverride() {
    if (!form) return
    const resource = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value?.trim()]).filter(([, value]) => value)) as NotificationResource
    const invalid = resourceOverrideError(resource)
    if (invalid) { setError(invalid); return }
    if (form.resourceOverrides.some(entry => ['namespace', 'repo', 'type', 'id'].every(key => entry.resource[key as keyof NotificationResource] === resource[key as keyof NotificationResource]))) {
      setError('An override for this exact resource already exists. Remove it before adding a different mode.')
      return
    }
    update({ ...form, resourceOverrides: [...form.resourceOverrides, { resource, mode }] })
    setDraft({})
    setError('')
  }
  async function enablePush() {
    if (!settings?.availability.push || !settings.availability.vapidPublicKey || !pushSupported) return
    setPushBusy(true)
    setPushError('')
    let created: PushSubscription | undefined
    try {
      // Permission is requested only in this explicit button action.
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') throw new Error(result === 'denied'
        ? 'Browser notifications are blocked. Allow notifications in your browser site settings, then try again.'
        : 'Browser permission was not granted. You can enable notifications later.')
      const registration = await navigator.serviceWorker.register('/notifications-sw.js', { scope: '/' })
      const ready = await navigator.serviceWorker.ready
      if (ready.scope !== registration.scope) throw new Error('The notifications service worker is not ready.')
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(settings.availability.vapidPublicKey) })
        created = subscription
      }
      await registerPushSubscription(subscription)
      setSubscribed(true)
      setStatus('This browser is registered. Enable Push for the desired categories below and save preferences.')
    } catch (err) {
      if (created) {
        try { await created.unsubscribe() } catch { /* The registration failure is shown below. */ }
      }
      setPushError(message(err))
    } finally { setPushBusy(false) }
  }
  async function disablePush() {
    setPushBusy(true)
    setPushError('')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await removePushSubscription(subscription.endpoint)
        const removed = await subscription.unsubscribe()
        if (!removed) throw new Error('Server delivery was disabled, but the browser subscription could not be removed. Try again.')
      }
      setSubscribed(false)
      setStatus('Push disabled for this browser. Saved category preferences and other devices are unchanged.')
    } catch (err) { setPushError(message(err)) }
    finally { setPushBusy(false) }
  }

  const Container = embedded ? 'section' : 'main'
  return <Container id={embedded ? 'notifications' : undefined} className={embedded ? 'settings-section' : 'page notification-page'} aria-label={embedded ? 'Notification preferences' : undefined}>
    <div className="page-head">
      <div>{embedded ? <h2><Bell className="button-label-icon" aria-hidden="true" />Notifications</h2> : <h1>Notifications</h1>}<p className="lede">Choose the activity and delivery channels that work for you.</p></div>
      <Link className="btn" to="/notifications"><Mail size={16} aria-hidden="true" />Open inbox</Link>
    </div>
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    {status && <p className="flash" role="status">{status}</p>}
    {loading && <p role="status">Loading preferences…</p>}
    {remoteChanged && <p className="flash" role="status">Settings changed in another tab. Your unsaved edits have been kept. Reload before saving to avoid replacing those changes.</p>}
    <button className="btn" type="button" disabled={loading || busy || pushBusy} onClick={() => { setLoading(true); setError(''); void load() }}><RefreshCw size={15} aria-hidden="true" />{remoteChanged ? 'Discard edits and reload' : 'Reload saved preferences'}</button>
    {form && settings && <form className="notification-settings form" onSubmit={event => void save(event)}>
      <fieldset disabled={busy || loading}>
        <legend><Bell size={18} aria-hidden="true" />Delivery preferences</legend>
        <label className="checkbox-row"><input type="checkbox" checked={form.enabled} onChange={event => update({ ...form, enabled: event.target.checked })} />Enable notifications</label>
        <p className="muted small">No alerts bypass this switch or your category choices. Inbox activity is immediate; quiet hours defer online toasts, email, and push. Email and Push are opt-in.</p>
        <div className="notification-matrix-scroll">
          <table className="notification-matrix">
            <caption>Category and channel preferences</caption>
            <thead><tr><th scope="col">Category</th><th scope="col">Enabled / Inbox</th><th scope="col">Online toast</th><th scope="col">Email</th><th scope="col">Push</th></tr></thead>
            <tbody>{notificationCategories.map(key => <tr key={key}>
              <th scope="row">{categoryLabel(key)}</th>
              {(['enabled', 'toast', 'email', 'push'] as const).map(channel => <td key={channel}>
                <input type="checkbox" aria-label={`${categoryLabel(key)} ${channel === 'enabled' ? 'enabled' : channel}`}
                  checked={form.categories[key]?.[channel] || false}
                  disabled={(channel === 'email' && !settings.availability.email) || (channel === 'push' && !settings.availability.push)}
                  onChange={event => category(key, channel, event.target.checked)} />
              </td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {!settings.availability.email && <p className="muted"><Mail size={15} className="button-label-icon" aria-hidden="true" />Email delivery is not configured by the administrator. Saved choices are retained, but email cannot be enabled here.</p>}
        {!settings.availability.push && <p className="muted"><BellOff size={15} className="button-label-icon" aria-hidden="true" />Push delivery is not configured by the administrator. Saved choices are retained, but push cannot be enabled here.</p>}
        <label>Email schedule<select value={form.emailSchedule} disabled={!settings.availability.email} onChange={event => update({ ...form, emailSchedule: event.target.value as NotificationPreferences['emailSchedule'] })}>
          <option value="immediate">Immediate</option><option value="daily">Daily digest</option><option value="weekly">Weekly digest</option>
        </select></label>
        <label>Timezone (IANA)<input required value={form.timezone} placeholder="Europe/Berlin" onChange={event => update({ ...form, timezone: event.target.value })} /></label>
        <button className="btn small" type="button" onClick={() => update({ ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}><Globe size={14} aria-hidden="true" />Use browser timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})</button>
        <label className="checkbox-row"><input type="checkbox" checked={form.quietHours.enabled} onChange={event => update({ ...form, quietHours: { ...form.quietHours, enabled: event.target.checked } })} />Enable quiet hours</label>
        <div className="notification-time-fields">
          <label>Start<input required type="time" value={form.quietHours.start} onChange={event => update({ ...form, quietHours: { ...form.quietHours, start: event.target.value } })} /></label>
          <label>End<input required type="time" value={form.quietHours.end} onChange={event => update({ ...form, quietHours: { ...form.quietHours, end: event.target.value } })} /></label>
        </div>
        <p className="muted small">Times use your saved timezone, including daylight saving changes. An end earlier than the start spans midnight.</p>
      </fieldset>
      <fieldset disabled={busy || loading}>
        <legend>Resource watch and mute overrides</legend>
        <p>All accessible resources are included by default. The nearest explicit override wins: a child watch can override a parent mute. Watch never grants access, overrides disabled categories, or enables an external channel. Personal outcomes are separate from resource muting.</p>
        <p className="muted small">Favorites notify by default; mute a resource to override. A favorite never overrides a disabled category.</p>
        <p className="muted small">Hierarchy: instance → namespace → repository → type → resource ID. Empty fields inherit their parent scope; leave all fields empty for the entire instance. Paths and IDs are exact resource identifiers, not wildcard patterns.</p>
        <ul className="notification-overrides">{form.resourceOverrides.map((entry, index) => <li key={index}>
          <div><strong>{entry.mode === 'watch' ? 'Watch' : 'Mute'}</strong> · {[entry.resource.namespace, entry.resource.repo, entry.resource.type, entry.resource.id].filter(Boolean).join(' / ') || 'Entire instance'}</div>
          <button className="btn small" type="button" aria-label={`Remove ${entry.mode} override ${index + 1}`} onClick={() => update({ ...form, resourceOverrides: form.resourceOverrides.filter((_, i) => i !== index) })}><Trash2 size={14} aria-hidden="true" />Remove</button>
        </li>)}</ul>
        <div className="notification-resource-fields">
          {(['namespace', 'repo', 'type', 'id'] as const).map(key => <label key={key}>{({ namespace: 'Namespace', repo: 'Repository', type: 'Resource type', id: 'Resource ID' })[key]}<input value={draft[key] || ''} placeholder={key === 'type' ? 'e.g. branch, path, job, session' : 'All / inherited'} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
          <label>Mode<select value={mode} onChange={event => setMode(event.target.value as 'watch' | 'mute')}><option value="mute">Mute</option><option value="watch">Watch</option></select></label>
        </div>
        <p className="muted small">Current effective resource setting for the scope above: <strong>{effectiveResourceMode(draft, form.resourceOverrides)}</strong>. An exact override replaces its inherited mode. Remove it to inherit the closest remaining parent override, or the default watch setting. Global and category controls still apply.</p>
        <button className="btn" type="button" onClick={addOverride}><Plus size={15} aria-hidden="true" />Add override</button>
      </fieldset>
      <button className="btn primary" type="submit" disabled={busy || loading || remoteChanged}><Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save preferences'}</button>
    </form>}
    <section className="notification-device">
      <h2><Download size={18} className="button-label-icon" aria-hidden="true" />Browser push</h2>
      <p>Push uses this browser's permission and device subscription. It can arrive while MICE is closed. Permission is requested only when you select Enable. Browser/OS settings and provider availability can delay or block delivery.</p>
      <p>Permission: <strong>{permission}</strong> · This browser: <strong>{subscribed ? 'subscription present' : 'not subscribed'}</strong></p>
      {!pushSupported && <p className="muted">Web Push requires HTTPS (or localhost) and a browser supporting notifications, service workers, and Push. Some mobile browsers require installing MICE on your home screen first.</p>}
      {settings?.availability.push && !settings.availability.vapidPublicKey && <p className="flash flash-error" role="alert">Push is configured but the server did not provide a VAPID public key. Ask the administrator to check push configuration.</p>}
      {permission === 'denied' && <p className="muted">Allow notifications for this site in your browser settings to enable push.</p>}
      {pushError && <p className="flash flash-error" role="alert">{pushError}</p>}
      <div className="notification-actions">
        <button className="btn" type="button" disabled={pushBusy || !pushSupported || !settings?.availability.push || !settings.availability.vapidPublicKey} onClick={() => void enablePush()}><Bell size={16} aria-hidden="true" />{pushBusy ? 'Updating…' : subscribed ? 'Refresh browser registration' : 'Enable on this browser'}</button>
        <button className="btn" type="button" disabled={pushBusy || !pushSupported || !subscribed} onClick={() => void disablePush()}><BellOff size={16} aria-hidden="true" />Disable on this browser</button>
      </div>
      <p className="muted small">Disabling here affects only this browser, not your other devices or category choices. Delivered email and push cannot be recalled if resource access is later revoked. Notification payloads contain summaries, not file contents or secrets.</p>
    </section>
  </Container>
}

function categoryLabel(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1) }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Notification request failed' }
function browserPushSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext &&
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
}
