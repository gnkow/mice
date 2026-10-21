import { FolderGit2 as ActionFolderGit2, FolderPlus as ActionFolderPlus, Trash2 as ActionTrash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  fetchCustomRolePermissions,
  fetchCustomRoles,
  type BasePermission,
  type NamespaceCapability,
  type RepoFinePermission,
} from '../lib/authzApi'

const REPO_BASES = ['read', 'triage', 'write', 'maintain'] as const
const NS_BASE_OPTS: BasePermission[] = [
  'none',
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]

type Props = {
  namespace: string
}

export function CustomRolesSection({ namespace }: Props) {
  const roles = useAsync(
    (signal) => fetchCustomRoles(namespace, signal),
    [namespace],
  )
  const catalog = useAsync(
    (signal) => fetchCustomRolePermissions(namespace, signal),
    [namespace],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [nsName, setNsName] = useState('')
  const [nsPerms, setNsPerms] = useState<NamespaceCapability[]>([])
  const [nsBase, setNsBase] = useState<BasePermission | ''>('')

  const [repoName, setRepoName] = useState('')
  const [repoBase, setRepoBase] =
    useState<(typeof REPO_BASES)[number]>('write')
  const [repoPerms, setRepoPerms] = useState<RepoFinePermission[]>([])

  if (roles.kind === 'error' && roles.message.includes('Forbidden')) {
    return null
  }

  const caps =
    catalog.kind === 'ok' ? catalog.data.namespaceCapabilities : []
  const fines = catalog.kind === 'ok' ? catalog.data.repoFinePermissions : []
  const implied =
    catalog.kind === 'ok' ? catalog.data.repoFineImpliedMin : null

  const rank: Record<string, number> = {
    none: 0,
    read: 1,
    triage: 2,
    write: 3,
    maintain: 4,
    admin: 5,
  }

  async function onCreateNs(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createCustomNamespaceRole(namespace, {
        name: nsName.trim(),
        permissions: nsPerms,
        ...(nsBase ? { baseRepositoryRole: nsBase } : {}),
      })
      setNsName('')
      setNsPerms([])
      setNsBase('')
      roles.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function onCreateRepo(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createCustomRepoRole(namespace, {
        name: repoName.trim(),
        base: repoBase,
        permissions: repoPerms,
      })
      setRepoName('')
      setRepoPerms([])
      roles.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="ns-custom-roles-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="ns-custom-roles-heading">Custom roles</h2>
          <p className="muted small">
            Custom namespace capabilities and repository roles (base + fine
            permissions). Permissions already implied by the base are skipped on
            save.
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {roles.kind === 'loading' && <p className="muted">Loading…</p>}

      {roles.kind === 'ok' && (
        <>
          <div className="ns-settings-section-head ns-settings-section-head-tight">
            <div>
              <h3 className="ns-settings-subhead">Namespace roles</h3>
              <p className="muted small">
                Assigned as membership instead of (or alongside) Member.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {roles.data.namespaceRoles.length} role
              {roles.data.namespaceRoles.length === 1 ? '' : 's'}
            </p>
          </div>

          {roles.data.namespaceRoles.length === 0 ? (
            <p className="muted small">No custom namespace roles yet.</p>
          ) : (
            <ul className="ns-member-list">
              {roles.data.namespaceRoles.map((r) => (
                <li key={r.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <code className="ns-member-sub">{r.name}</code>
                    <span className="muted small">
                      {r.permissions.join(', ') || 'no capabilities'}
                      {r.baseRepositoryRole
                        ? ` · repo base ${r.baseRepositoryRole}`
                        : ''}
                    </span>
                  </div>
                  <span className="ns-tag">namespace</span>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() =>
                      void deleteCustomNamespaceRole(namespace, r.id)
                        .then(() => roles.reload())
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Delete failed',
                          ),
                        )
                    }
                  >
                    <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="ns-member-form" onSubmit={onCreateNs}>
            <h3 className="ns-settings-subhead">New namespace role</h3>
            <div className="ns-member-form-fields cols-2-fields">
              <label>
                Name
                <input
                  required
                  value={nsName}
                  onChange={(e) => setNsName(e.target.value)}
                  placeholder="Auditor"
                  autoComplete="off"
                />
              </label>
              <label>
                Optional repo base
                <select
                  value={nsBase}
                  onChange={(e) =>
                    setNsBase(e.target.value as BasePermission | '')
                  }
                >
                  <option value="">none</option>
                  {NS_BASE_OPTS.filter((o) => o !== 'none').map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="ns-check-fieldset">
              <legend>Capabilities</legend>
              <div className="ns-check-grid">
                {caps.map((c) => (
                  <label key={c} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={nsPerms.includes(c)}
                      onChange={(e) =>
                        setNsPerms((prev) =>
                          e.target.checked
                            ? [...prev, c]
                            : prev.filter((x) => x !== c),
                        )
                      }
                    />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="ns-member-form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionFolderPlus size={14} aria-hidden="true" className="button-label-icon" />Create namespace role
              </button>
            </div>
          </form>

          <div className="ns-settings-section-head ns-settings-section-head-spaced">
            <div>
              <h3 className="ns-settings-subhead">Repository roles</h3>
              <p className="muted small">
                Assigned on repo collaborators. Inherit a base role, then add
                fine permissions.
              </p>
            </div>
            <p className="muted small ns-settings-count">
              {roles.data.repoRoles.length} role
              {roles.data.repoRoles.length === 1 ? '' : 's'}
            </p>
          </div>

          {roles.data.repoRoles.length === 0 ? (
            <p className="muted small">No custom repository roles yet.</p>
          ) : (
            <ul className="ns-member-list">
              {roles.data.repoRoles.map((r) => (
                <li key={r.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <code className="ns-member-sub">{r.name}</code>
                    <span className="muted small">
                      base {r.base}
                      {r.permissions.length
                        ? ` + ${r.permissions.join(', ')}`
                        : ''}
                    </span>
                  </div>
                  <span className="ns-tag">{r.base}</span>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() =>
                      void deleteCustomRepoRole(namespace, r.id)
                        .then(() => roles.reload())
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Delete failed',
                          ),
                        )
                    }
                  >
                    <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="ns-member-form" onSubmit={onCreateRepo}>
            <h3 className="ns-settings-subhead">New repository role</h3>
            <div className="ns-member-form-fields cols-2-fields">
              <label>
                Name
                <input
                  required
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="Merger"
                  autoComplete="off"
                />
              </label>
              <label>
                Inherited base
                <select
                  value={repoBase}
                  onChange={(e) =>
                    setRepoBase(e.target.value as (typeof REPO_BASES)[number])
                  }
                >
                  {REPO_BASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="ns-check-fieldset">
              <legend>Additional permissions</legend>
              <div className="ns-check-grid">
                {fines.map((f) => {
                  const min = implied?.[f] ?? 'admin'
                  const disabled = rank[repoBase] >= rank[min]
                  return (
                    <label
                      key={f}
                      className={
                        disabled
                          ? 'checkbox-row checkbox-row-disabled'
                          : 'checkbox-row'
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={!disabled && repoPerms.includes(f)}
                        onChange={(e) =>
                          setRepoPerms((prev) =>
                            e.target.checked
                              ? [...prev, f]
                              : prev.filter((x) => x !== f),
                          )
                        }
                      />
                      <span>
                        {f}
                        {disabled ? (
                          <span className="muted"> · in base</span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="ns-member-form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />Create repository role
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
