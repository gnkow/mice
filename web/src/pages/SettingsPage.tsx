import { useEffect, useState, type FormEvent } from 'react'
import { fetchServerVersion } from '../lib/oxen/api'
import {
  loadSettings,
  saveSettings,
  type OxenSettings,
} from '../lib/oxen/settings'

export function SettingsPage() {
  const [form, setForm] = useState<OxenSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)

  useEffect(() => {
    setForm(loadSettings())
  }, [])

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

  return (
    <main className="page narrow">
      <h1>Settings</h1>
      <p className="lede">
        Leave API base empty to use the Compose/Vite proxy (`/api` →
        oxen-server). Set a bearer token if you put a gateway in front.
      </p>

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
        <label>
          Bearer token
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>
        <label>
          Commit author name
          <input
            value={form.authorName}
            onChange={(e) =>
              setForm((f) => ({ ...f, authorName: e.target.value }))
            }
            placeholder="Boxen"
            autoComplete="off"
          />
        </label>
        <label>
          Commit author email
          <input
            value={form.authorEmail}
            onChange={(e) =>
              setForm((f) => ({ ...f, authorEmail: e.target.value }))
            }
            placeholder="boxen@localhost"
            autoComplete="off"
          />
        </label>
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
