import { Copy, KeyRound, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { createToken, listTokens, revokeToken } from '../lib/tokens'

export function ProfileTokensSection() {
  const me = useAsync((signal) => fetchAuthzMe(signal), [])
  const allowed = me.kind === 'ok' && !!me.data &&
    (!me.data.enforce || me.data.instanceAdmin || me.data.permissions.manage_own_tokens)
  const tokens = useAsync(() => allowed ? listTokens() : Promise.resolve([]), [allowed])
  const [label, setLabel] = useState('CLI token')
  const [expiresInDays, setExpiresInDays] = useState(90)
  const [secret, setSecret] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSecret(undefined)
    try {
      const result = await createToken(label, expiresInDays)
      setSecret(result.token)
      tokens.reload()
    } catch (err) { setError(err instanceof Error ? err.message : 'Create failed') }
    finally { setBusy(false) }
  }

  async function revoke(id: string) {
    setBusy(true)
    setError('')
    try {
      await revokeToken(id)
      setSecret(undefined)
      tokens.reload()
    } catch (err) { setError(err instanceof Error ? err.message : 'Revoke failed') }
    finally { setBusy(false) }
  }

  return <section id="cli-tokens" className="settings-section" aria-labelledby="cli-tokens-heading">
    <div className="ns-settings-section-head">
      <div><h2 id="cli-tokens-heading"><KeyRound size={18} className="button-label-icon" aria-hidden="true" />CLI tokens</h2>
        <p className="muted small">Use <code>mice login</code> for day-to-day access. Create personal access tokens for CI and automation; connect through the auth BFF, not raw oxen-server.</p></div>
      {allowed && tokens.kind === 'ok' && <p className="muted small ns-settings-count">{tokens.data.length} token{tokens.data.length === 1 ? '' : 's'}</p>}
    </div>
    {me.kind === 'loading' && <p role="status">Checking token permissions...</p>}
    {me.kind === 'error' && <p className="flash flash-error" role="alert">{me.message}</p>}
    {me.kind === 'ok' && !allowed && <p className="muted small">You need the <code>manage_own_tokens</code> instance permission to list or create PATs.</p>}
    {allowed && <>
      <details><summary>CLI setup and automation examples</summary>
        <pre className="settings-code mono">{`mice login
mice clone http://localhost:8080/<namespace>/<repo>

# Automation / CI
oxen config --auth localhost:8080 <PAT>
oxen clone http://localhost:8080/<namespace>/<repo>

# Jobs (inside a clone; login or MICE_PAT)
mice job run --image alpine:3.20 -- touch out.txt
mice push`}</pre>
      </details>
      <form className="ns-member-form" onSubmit={create}>
        <div className="ns-member-form-fields cols-label-action">
          <label>Token label<input value={label} onChange={event => setLabel(event.target.value)} placeholder="CLI token" autoComplete="off" /></label>
          <label>Expires in<select value={expiresInDays} onChange={event => setExpiresInDays(Number(event.target.value))}>
            {[30, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
          </select></label>
          <div className="ns-member-form-actions"><button className="btn primary" type="submit" disabled={busy}><KeyRound size={14} className="button-label-icon" aria-hidden="true" />Create token</button></div>
        </div>
      </form>
      {secret && <div className="flash flash-warn" role="status">
        <p>Copy this token now — it will not be shown again.</p>
        <pre className="settings-code mono">{secret}</pre>
        <button className="btn ghost" type="button" onClick={() => {
          void navigator.clipboard.writeText(secret).catch(err => setError(err instanceof Error ? err.message : 'Copy failed'))
        }}><Copy size={14} className="button-label-icon" aria-hidden="true" />Copy token</button>
      </div>}
      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {tokens.kind === 'error' && <p className="flash flash-error" role="alert">{tokens.message}</p>}
      {tokens.kind === 'loading' && <p role="status">Loading tokens...</p>}
      {tokens.kind === 'ok' && (tokens.data.length ? <ul className="ns-member-list">
        {tokens.data.map(token => <li key={token.id} className="ns-member-row">
          <div className="ns-member-main"><code className="ns-member-sub">{token.label}</code>
            <span className="muted small"><span className="mono">{token.prefix}…</span> · Created {new Date(token.createdAt).toLocaleString()}{token.lastUsedAt ? ` · Last used ${new Date(token.lastUsedAt).toLocaleString()}` : ' · Never used'}{token.expiresAt ? ` · Expires ${new Date(token.expiresAt).toLocaleDateString()}` : ''}</span></div>
          <button className="btn ghost small" type="button" disabled={busy} onClick={() => void revoke(token.id)}><Trash2 size={14} className="button-label-icon" aria-hidden="true" />Revoke</button>
        </li>)}
      </ul> : <p className="muted small">No CLI tokens yet.</p>)}
    </>}
  </section>
}
