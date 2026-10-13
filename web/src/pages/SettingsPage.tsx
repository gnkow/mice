import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fetchServerVersion } from '../lib/oxen/api'
import {
  loadSettings,
  saveSettings,
  type OxenSettings,
} from '../lib/oxen/settings'
import {
  createToken,
  listTokens,
  revokeToken,
  type PatPublic,
} from '../lib/tokens'

export function SettingsPage() {
  const [form, setForm] = useState<OxenSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const [tokens, setTokens] = useState<PatPublic[]>([])
  const [tokenLabel, setTokenLabel] = useState('CLI token')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  const reloadTokens = useCallback(async () => {
    try {
      setTokens(await listTokens())
    } catch {
      setTokens([])
    }
  }, [])

  useEffect(() => {
    setForm(loadSettings())
    void reloadTokens()
  }, [reloadTokens])

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

  async function onCreateToken(e: FormEvent) {
    e.preventDefault()
    setTokenBusy(true)
    setTokenError(null)
    setNewToken(null)
    try {
      const created = await createToken(tokenLabel)
      setNewToken(created.token)
      await reloadTokens()
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setTokenBusy(false)
    }
  }

  async function onRevoke(id: string) {
    setTokenBusy(true)
    setTokenError(null)
    try {
      await revokeToken(id)
      if (newToken) setNewToken(null)
      await reloadTokens()
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Revoke failed')
    } finally {
      setTokenBusy(false)
    }
  }

  return (
    <main className="page narrow">
      <h1>Settings</h1>
      <p className="lede">
        Interactive access uses SSO via the auth BFF (session cookie). Leave API
        base empty for the Compose/Vite proxy (`/api` → auth → oxen-server).
        Commit author identity comes from your IdP session, not from this page.
      </p>

      <section className="settings-section" aria-labelledby="cli-tokens-heading">
        <h2 id="cli-tokens-heading">CLI tokens</h2>
        <p className="muted small">
          Personal access tokens for the Oxen CLI and Python client. Point the
          CLI at the <strong>auth BFF</strong> (not raw oxen-server :3001):
        </p>
        <pre className="settings-code mono">
          {`oxen config --auth localhost:8080 <PAT>
oxen clone http://localhost:8080/<namespace>/<repo>`}
        </pre>

        <form className="form" onSubmit={onCreateToken}>
          <label>
            Token label
            <input
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
              placeholder="CLI token"
              autoComplete="off"
            />
          </label>
          <div className="btn-row">
            <button className="btn" type="submit" disabled={tokenBusy}>
              Create token
            </button>
          </div>
        </form>

        {newToken && (
          <div className="flash flash-warn" role="status">
            <p>
              Copy this token now — it will not be shown again.
            </p>
            <pre className="settings-code mono">{newToken}</pre>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void navigator.clipboard.writeText(newToken)}
            >
              Copy token
            </button>
          </div>
        )}

        {tokenError && <p className="flash flash-error">{tokenError}</p>}

        {tokens.length > 0 ? (
          <ul className="token-list">
            {tokens.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.label}</strong>
                  <span className="muted small mono"> {t.prefix}…</span>
                  <br />
                  <span className="muted small">
                    Created {new Date(t.createdAt).toLocaleString()}
                    {t.lastUsedAt
                      ? ` · Last used ${new Date(t.lastUsedAt).toLocaleString()}`
                      : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn ghost danger"
                  disabled={tokenBusy}
                  onClick={() => void onRevoke(t.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No CLI tokens yet.</p>
        )}
      </section>

      <form className="form" onSubmit={onSave}>
        <label>
          API base URL
          <input
            value={form.apiBase}
            onChange={(e) =>
              setForm((f) => ({ ...f, apiBase: e.target.value }))
            }
            placeholder="(empty = same-origin /api)"
            autoComplete="off"
          />
        </label>

        <fieldset className="settings-advanced">
          <legend>Advanced / automation</legend>
          <p className="muted small">
            Break-glass bearer accepted by the BFF when configured as{' '}
            <code>AUTH_BREAKGLASS_TOKEN</code>. Prefer CLI tokens above for
            normal automation.
          </p>
          <label>
            Bearer token
            <input
              type="password"
              value={form.token}
              onChange={(e) =>
                setForm((f) => ({ ...f, token: e.target.value }))
              }
              placeholder="Optional break-glass token"
              autoComplete="off"
            />
          </label>
        </fieldset>

        <div className="btn-row">
          <button className="btn" type="submit">
            Save
          </button>
          <button className="btn ghost" type="button" onClick={onTest}>
            Test connection
          </button>
        </div>
        {saved && <p className="ok">Saved.</p>}
        {probe && <p className="muted">{probe}</p>}
      </form>
    </main>
  )
}
