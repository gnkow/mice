import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import {
  addInstanceAdmin,
  fetchInstance,
  listAccessRequests,
  listAuthzNamespaces,
  patchInstanceEnforce,
  removeInstanceAdmin,
  resolveAccessRequest,
  setInstancePermissions,
  type AccessRequestRow,
  type InstancePermission,
  type MemberRoleRef,
} from '../lib/authzApi'
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

const INSTANCE_PERMS: InstancePermission[] = [
  'create_namespace',
  'view_audit',
]

export function SettingsPage() {
  const me = useAsync((signal) => fetchAuthzMe(signal), [])
  const [form, setForm] = useState<OxenSettings>(loadSettings)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const [tokens, setTokens] = useState<PatPublic[]>([])
  const [tokenLabel, setTokenLabel] = useState('CLI token')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)

  const isInstanceAdmin = me.kind === 'ok' && !!me.data?.instanceAdmin

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
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            Interactive access uses SSO via the auth BFF (session cookie). Leave
            API base empty for the Compose/Vite proxy (`/api` → auth →
            oxen-server). Commit author identity comes from your IdP session,
            not from this page.
          </p>
        </div>
      </div>

      <div className="ns-settings">
        {me.kind === 'ok' && me.data && (
          <AccessRequestsSection isInstanceAdmin={!!isInstanceAdmin} />
        )}

        {isInstanceAdmin && <InstanceAdminSection />}

        <section
          className="settings-section"
          aria-labelledby="cli-tokens-heading"
        >
          <div className="ns-settings-section-head">
            <div>
              <h2 id="cli-tokens-heading">CLI tokens</h2>
              <p className="muted small">
                Day-to-day: run <code className="mono">boxen login</code> (browser
                authorize). For CI / automation, mint a PAT below and point oxen
                at the <strong>auth BFF</strong> (not raw oxen-server :3001):
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {tokens.length} token{tokens.length === 1 ? '' : 's'}
            </p>
          </div>
          <pre className="settings-code mono">
            {`boxen login
boxen clone http://localhost:8080/<namespace>/<repo>

# Automation / CI
oxen config --auth localhost:8080 <PAT>
oxen clone http://localhost:8080/<namespace>/<repo>`}
          </pre>

          <form className="ns-member-form" onSubmit={onCreateToken}>
            <div className="ns-member-form-fields cols-label-action">
              <label>
                Token label
                <input
                  value={tokenLabel}
                  onChange={(e) => setTokenLabel(e.target.value)}
                  placeholder="CLI token"
                  autoComplete="off"
                />
              </label>
              <div className="ns-member-form-actions">
                <button
                  className="btn primary"
                  type="submit"
                  disabled={tokenBusy}
                >
                  Create token
                </button>
              </div>
            </div>
          </form>

          {newToken && (
            <div className="flash flash-warn" role="status">
              <p>Copy this token now — it will not be shown again.</p>
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

          {tokenError && <p className="error">{tokenError}</p>}

          {tokens.length > 0 ? (
            <ul className="ns-member-list">
              {tokens.map((t) => (
                <li key={t.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <code className="ns-member-sub">{t.label}</code>
                    <span className="muted small">
                      <span className="mono">{t.prefix}…</span>
                      {' · '}
                      Created {new Date(t.createdAt).toLocaleString()}
                      {t.lastUsedAt
                        ? ` · Last used ${new Date(t.lastUsedAt).toLocaleString()}`
                        : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost small"
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

        <section
          className="settings-section"
          aria-labelledby="connection-heading"
        >
          <div className="ns-settings-section-head">
            <div>
              <h2 id="connection-heading">Connection</h2>
              <p className="muted small">
                Optional override for API base URL.
              </p>
            </div>
          </div>
          <form className="ns-member-form" onSubmit={onSave}>
            <div className="ns-settings-grid">
              <label className="ns-settings-field">
                <span className="ns-settings-label">API base URL</span>
                <input
                  value={form.apiBase}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, apiBase: e.target.value }))
                  }
                  placeholder="(empty = same-origin /api)"
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="btn-row ns-settings-actions">
              <button className="btn primary" type="submit">
                Save
              </button>
              <button className="btn ghost" type="button" onClick={onTest}>
                Test connection
              </button>
            </div>
            {saved && <p className="ok">Saved.</p>}
            {probe && <p className="muted">{probe}</p>}
          </form>
        </section>
      </div>
    </main>
  )
}

function AccessRequestsSection({
  isInstanceAdmin,
}: {
  isInstanceAdmin: boolean
}) {
  const state = useAsync(async (signal) => {
    try {
      return await listAccessRequests(signal)
    } catch {
      return null
    }
  }, [])
  const nsList = useAsync(async (signal) => {
    try {
      const data = await listAuthzNamespaces(signal)
      return data.namespaces
    } catch {
      return []
    }
  }, [])

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [approveNs, setApproveNs] = useState('')
  const [approveRole, setApproveRole] = useState<MemberRoleRef>('member')
  const [approvePerm, setApprovePerm] = useState<InstancePermission | ''>('')

  if (state.kind === 'ok' && state.data === null) return null

  const requests =
    state.kind === 'ok' && state.data
      ? state.data.requests.filter((r) => r.status === 'pending')
      : []
  const reviewNamespaces =
    state.kind === 'ok' && state.data ? state.data.reviewNamespaces : []
  const nsOptions =
    nsList.kind === 'ok'
      ? nsList.data.filter(
          (n) =>
            isInstanceAdmin ||
            n.role === 'owner' ||
            reviewNamespaces.includes(n.name),
        )
      : []

  async function onDeny(req: AccessRequestRow) {
    setBusy(true)
    setError(null)
    try {
      await resolveAccessRequest(req.id, 'deny')
      state.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deny failed')
    } finally {
      setBusy(false)
    }
  }

  async function onApprove(e: FormEvent) {
    e.preventDefault()
    if (!approveId) return
    setBusy(true)
    setError(null)
    try {
      if (approvePerm && isInstanceAdmin) {
        await resolveAccessRequest(approveId, 'approve', {
          permission: approvePerm,
        })
      } else if (approveNs) {
        await resolveAccessRequest(approveId, 'approve', {
          namespace: approveNs,
          role: approveRole,
        })
      } else if (isInstanceAdmin) {
        await resolveAccessRequest(approveId, 'approve')
      } else {
        throw new Error('Choose a namespace to approve into')
      }
      setApproveId(null)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="access-requests-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-requests-heading">Access requests</h2>
          <p className="muted small">
            Pending SSO users waiting for a namespace seat or instance
            permission.
          </p>
        </div>
        <p className="muted small ns-settings-count">
          {requests.length} pending
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {state.kind === 'ok' && requests.length === 0 && (
        <p className="muted small">No pending requests.</p>
      )}
      {requests.length > 0 && (
        <ul className="ns-member-list">
          {requests.map((r) => (
            <li
              key={r.id}
              className="ns-member-row"
              data-access-request={r.id}
            >
              <div className="ns-member-main">
                <code className="ns-member-sub">{r.name}</code>
                <span className="muted small">
                  {r.email}
                  {' · '}
                  <span className="mono">
                    {r.sub}@{r.iss}
                  </span>
                </span>
                {r.message ? (
                  <span className="muted small">{r.message}</span>
                ) : null}
              </div>
              <span className="ns-tag">pending</span>
              <button
                type="button"
                className="btn primary small"
                disabled={busy}
                onClick={() => {
                  setApproveId(r.id)
                  setApproveNs(nsOptions[0]?.name ?? '')
                  setApproveRole('member')
                  setApprovePerm('')
                }}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => void onDeny(r)}
              >
                Deny
              </button>
            </li>
          ))}
        </ul>
      )}

      {approveId && (
        <form className="ns-member-form" onSubmit={onApprove}>
          <h3 className="ns-settings-subhead">Approve request</h3>
          <div className="ns-member-form-fields cols-3">
            {isInstanceAdmin && (
              <label>
                Instance permission
                <select
                  value={approvePerm}
                  onChange={(e) =>
                    setApprovePerm(e.target.value as InstancePermission | '')
                  }
                >
                  <option value="">Namespace seat…</option>
                  {INSTANCE_PERMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!approvePerm && (
              <>
                <label>
                  Namespace
                  <select
                    value={approveNs}
                    onChange={(e) => setApproveNs(e.target.value)}
                    required={!isInstanceAdmin}
                  >
                    <option value="">Select namespace</option>
                    {nsOptions.map((n) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Role
                  <select
                    value={approveRole}
                    onChange={(e) =>
                      setApproveRole(e.target.value as MemberRoleRef)
                    }
                  >
                    <option value="member">member</option>
                    <option value="owner">owner</option>
                  </select>
                </label>
              </>
            )}
            <div className="ns-member-form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                Confirm
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={busy}
                onClick={() => setApproveId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}

function InstanceAdminSection() {
  const state = useAsync((signal) => fetchInstance(signal), [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminSub, setAdminSub] = useState('')
  const [adminIss, setAdminIss] = useState('boxen-dev')
  const [permSub, setPermSub] = useState('')
  const [permIss, setPermIss] = useState('boxen-dev')
  const [permChecks, setPermChecks] = useState<InstancePermission[]>([
    'create_namespace',
  ])

  if (state.kind === 'error') {
    return (
      <section className="settings-section">
        <h2>Instance admin</h2>
        <p className="error">{state.message}</p>
      </section>
    )
  }

  const data = state.kind === 'ok' ? state.data : null

  async function onAddAdmin(e: FormEvent) {
    e.preventDefault()
    if (!adminSub.trim() || !adminIss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addInstanceAdmin({ sub: adminSub.trim(), iss: adminIss.trim() })
      setAdminSub('')
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
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

  async function onSetPerms(e: FormEvent) {
    e.preventDefault()
    if (!permSub.trim() || !permIss.trim()) {
      setError('Choose a user from search or enter sub/iss manually')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setInstancePermissions(
        { sub: permSub.trim(), iss: permIss.trim() },
        permChecks,
      )
      setPermSub('')
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function onToggleEnforce() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      await patchInstanceEnforce(!data.enforce)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="instance-admin-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="instance-admin-heading">Instance admin</h2>
          <p className="muted small">
            Instance admins and delegated permissions (
            <code>create_namespace</code>, <code>view_audit</code>).
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {state.kind === 'loading' && <p className="muted">Loading…</p>}
      {data && (
        <>
          <label className="ns-settings-toggle">
            <input
              type="checkbox"
              checked={data.enforce}
              disabled={busy}
              onChange={() => void onToggleEnforce()}
            />
            <span>
              <span className="ns-settings-label">AuthZ enforce</span>
              <span className="muted small">
                Currently {data.enforce ? 'on' : 'off'}. Env{' '}
                <code>AUTHZ_ENFORCE</code> overrides this store flag when set.
              </span>
            </span>
          </label>

          <div className="ns-settings-section-head ns-settings-section-head-tight">
            <div>
              <h3 className="ns-settings-subhead">Admins</h3>
              <p className="muted small">
                Full instance catalog and site-admin bypass.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.admins.length} admin{data.admins.length === 1 ? '' : 's'}
            </p>
          </div>
          <ul className="ns-member-list">
            {data.admins.map((a) => (
              <li key={`${a.iss}\0${a.sub}`} className="ns-member-row">
                <div className="ns-member-main">
                  <code className="ns-member-sub">{a.sub}</code>
                  <span className="muted small">{a.iss}</span>
                </div>
                <span className="ns-tag ns-tag-accent">admin</span>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => void onRemoveAdmin(a.sub, a.iss)}
                >
                  Remove
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
                iss={adminIss}
                defaultIss="boxen-dev"
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setAdminSub(sub)
                  setAdminIss(iss)
                }}
              />
              <div className="ns-member-form-actions">
                <button className="btn primary" type="submit" disabled={busy}>
                  Add admin
                </button>
              </div>
            </div>
          </form>

          <div className="ns-settings-section-head ns-settings-section-head-spaced">
            <div>
              <h3 className="ns-settings-subhead">Instance permissions</h3>
              <p className="muted small">
                Delegate individual instance permissions to non-admins.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {data.permissions.length} grant
              {data.permissions.length === 1 ? '' : 's'}
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
                    Clear
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
                iss={permIss}
                defaultIss="boxen-dev"
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setPermSub(sub)
                  setPermIss(iss)
                }}
              />
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
                Set permissions
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
