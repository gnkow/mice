import { ChevronUp as ActionChevronUp, FolderGit2 as ActionFolderGit2, Plus as ActionPlus, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  NamespaceCreateSettings,
  type NamespaceCreateSettingsValue,
} from '../components/NamespaceCreateSettings'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import {
  createNamespaceAuthz,
  listAuthzNamespaces,
  putNamespaceMember,
  putRepoCollaborator,
  type RepoRole,
} from '../lib/authzApi'
import { createRepository, listNamespaces, uploadFile } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

const REPO_ROLES: RepoRole[] = [
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]

const NEW_NS = '__new__'

type PendingCollaborator =
  | { kind: 'user'; sub: string; iss: string; role: RepoRole }
  | { kind: 'group'; group: string; role: RepoRole }

function readmeContents(name: string, description: string) {
  const desc = description.trim()
  return desc ? `# ${name}\n\n${desc}\n` : `# ${name}\n`
}

const emptyNsSettings = (): NamespaceCreateSettingsValue => ({
  name: '',
  basePermission: 'none',
  membersCanCreateRepos: true,
  members: [],
})

export function NewRepoPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const presetNs = params.get('namespace') ?? ''

  const oxenNs = useAsync((signal) => listNamespaces(signal), [])
  const authzNs = useAsync((signal) => listAuthzNamespaces(signal), [])
  const me = useAsync((signal) => fetchAuthzMe(signal), [])

  const [namespaceChoice, setNamespaceChoice] = useState(presetNs || NEW_NS)
  const [nsSettings, setNsSettings] = useState(emptyNsSettings)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [initReadme, setInitReadme] = useState(true)
  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>(
    [],
  )
  const [collabKind, setCollabKind] = useState<'user' | 'group'>('user')
  const [collabSub, setCollabSub] = useState('')
  const [collabIss, setCollabIss] = useState('mice-dev')
  const [collabGroup, setCollabGroup] = useState('')
  const [collabRole, setCollabRole] = useState<RepoRole>('read')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nsDefaulted, setNsDefaulted] = useState(Boolean(presetNs))

  const knownNamespaces = useMemo(() => {
    const names = new Set<string>()
    if (oxenNs.kind === 'ok') {
      for (const ns of oxenNs.data.namespaces) names.add(ns.namespace)
    }
    if (authzNs.kind === 'ok') {
      for (const ns of authzNs.data.namespaces) names.add(ns.name)
    }
    if (presetNs) names.add(presetNs)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [oxenNs, authzNs, presetNs])

  const listsReady = oxenNs.kind === 'ok' && authzNs.kind === 'ok'

  useEffect(() => {
    if (nsDefaulted || !listsReady) return
    if (presetNs) {
      setNamespaceChoice(presetNs)
      setNsDefaulted(true)
      return
    }
    if (knownNamespaces.length > 0) {
      setNamespaceChoice(knownNamespaces[0]!)
    }
    setNsDefaulted(true)
  }, [nsDefaulted, listsReady, presetNs, knownNamespaces])

  const creatingNewNamespace = namespaceChoice === NEW_NS
  const canCreateNamespace =
    me.kind === 'ok' &&
    me.data &&
    (me.data.instanceAdmin || me.data.permissions.create_namespace)
  const nsFieldsDisabled =
    busy || (me.kind === 'ok' && !canCreateNamespace)

  const cancelTo = presetNs
    ? `/n/${encodeURIComponent(presetNs)}`
    : '/repositories'

  function addCollaborator() {
    if (collabKind === 'group') {
      const group = collabGroup.trim()
      if (!group) return
      setCollaborators((prev) => {
        const without = prev.filter(
          (c) => !(c.kind === 'group' && c.group === group),
        )
        return [...without, { kind: 'group', group, role: collabRole }]
      })
      setCollabGroup('')
      return
    }
    const sub = collabSub.trim()
    const iss = collabIss.trim()
    if (!sub || !iss) return
    setCollaborators((prev) => {
      const without = prev.filter(
        (c) => !(c.kind === 'user' && c.sub === sub && c.iss === iss),
      )
      return [...without, { kind: 'user', sub, iss, role: collabRole }]
    })
    setCollabSub('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const ns = creatingNewNamespace
      ? nsSettings.name.trim()
      : namespaceChoice.trim()
    const repoName = name.trim()
    const desc = description.trim()

    if (!ns) {
      setError('Namespace is required')
      setBusy(false)
      return
    }

    try {
      if (creatingNewNamespace) {
        if (!canCreateNamespace) {
          throw new Error(
            'You need create_namespace permission or instance admin to create a namespace.',
          )
        }
        await createNamespaceAuthz({
          name: ns,
          basePermission: nsSettings.basePermission,
          membersCanCreateRepos: nsSettings.membersCanCreateRepos,
        })
        for (const m of nsSettings.members) {
          await putNamespaceMember(ns, m)
        }
      }

      const res = await createRepository({
        namespace: ns,
        name: repoName,
        description: desc || undefined,
      })
      const createdNs = res.repository.namespace
      const createdName = res.repository.name

      try {
        if (initReadme) {
          const file = new File(
            [readmeContents(createdName, desc)],
            'README.md',
            { type: 'text/markdown' },
          )
          await uploadFile(
            createdNs,
            createdName,
            'main',
            'README.md',
            file,
            'Initialize with README',
          )
        }
        for (const c of collaborators) {
          await putRepoCollaborator(createdNs, createdName, c)
        }
      } catch {
        // Repo exists; open it even if README / collaborators partially failed.
      }

      navigate(
        `/n/${encodeURIComponent(createdNs)}/r/${encodeURIComponent(createdName)}/tree/main`,
      )
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Create failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page new-repo-page">
      <p className="muted small">
        <Link to={cancelTo}>← Back</Link>
      </p>
      <h1>New repository</h1>

      <form className="form new-repo-form" onSubmit={onSubmit}>
        <section className="new-repo-section">
          <label>
            Namespace
            <select
              value={namespaceChoice}
              onChange={(e) => setNamespaceChoice(e.target.value)}
              disabled={busy}
            >
              {knownNamespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
              <option value={NEW_NS}>New namespace…</option>
            </select>
          </label>

          {creatingNewNamespace && (
            <div className="new-repo-new-ns">
              {me.kind === 'ok' && !canCreateNamespace ? (
                <p className="flash flash-error" role="status">
                  You need <code>create_namespace</code> or instance admin to
                  create a namespace.
                </p>
              ) : (
                <NamespaceCreateSettings
                  value={nsSettings}
                  onChange={setNsSettings}
                  disabled={nsFieldsDisabled}
                  nameLabel="New namespace name"
                />
              )}
            </div>
          )}

          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="dataset"
              autoComplete="off"
              pattern="[A-Za-z0-9._-]+"
              title="Letters, numbers, dots, underscores, hyphens"
              disabled={busy}
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional short summary"
              disabled={busy}
            />
          </label>

          {showMore && (
            <div className="new-repo-more">
              <label className="ns-settings-toggle">
                <input
                  type="checkbox"
                  checked={initReadme}
                  onChange={(e) => setInitReadme(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  <strong>Initialize with README</strong>
                  <span className="muted small">
                    Commit a README.md on <code>main</code>.
                  </span>
                </span>
              </label>

              <div className="new-repo-collab">
                <h3 className="new-repo-subhead">Collaborators</h3>
                {collaborators.length > 0 && (
                  <ul className="simple-list">
                    {collaborators.map((c) => (
                      <li
                        key={
                          c.kind === 'group'
                            ? `group:${c.group}`
                            : `${c.iss}:${c.sub}`
                        }
                      >
                        {c.kind === 'group' ? (
                          <>
                            <code>{c.group}</code>
                            <span className="muted small">· IdP group</span>
                          </>
                        ) : (
                          <>
                            <code>{c.sub}</code>
                            <span className="muted small">· {c.iss}</span>
                          </>
                        )}
                        <span className="ns-tag">{c.role}</span>
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() =>
                            setCollaborators((prev) =>
                              prev.filter((x) =>
                                c.kind === 'group'
                                  ? !(
                                      x.kind === 'group' &&
                                      x.group === c.group
                                    )
                                  : !(
                                      x.kind === 'user' &&
                                      x.sub === c.sub &&
                                      x.iss === c.iss
                                    ),
                              ),
                            )
                          }
                        >
                          <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="new-repo-collab-row">
                  <label>
                    Principal
                    <select
                      value={collabKind}
                      onChange={(e) =>
                        setCollabKind(e.target.value as 'user' | 'group')
                      }
                      disabled={busy}
                    >
                      <option value="user">User</option>
                      <option value="group">IdP group</option>
                    </select>
                  </label>
                  {collabKind === 'group' ? (
                    <label>
                      Group
                      <input
                        value={collabGroup}
                        onChange={(e) => setCollabGroup(e.target.value)}
                        placeholder="engineering"
                        autoComplete="off"
                        disabled={busy}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        Subject
                        <input
                          value={collabSub}
                          onChange={(e) => setCollabSub(e.target.value)}
                          placeholder="user-sub"
                          autoComplete="off"
                          disabled={busy}
                        />
                      </label>
                      <label>
                        Issuer
                        <input
                          value={collabIss}
                          onChange={(e) => setCollabIss(e.target.value)}
                          placeholder="mice-dev"
                          autoComplete="off"
                          disabled={busy}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    Role
                    <select
                      value={collabRole}
                      onChange={(e) =>
                        setCollabRole(e.target.value as RepoRole)
                      }
                      disabled={busy}
                    >
                      {REPO_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || !collabSub.trim() || !collabIss.trim()}
                    onClick={addCollaborator}
                  >
                    <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />Add
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn ghost small new-repo-more-btn"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
          >
            <ActionChevronUp size={14} aria-hidden="true" className="button-label-icon" />{showMore ? 'Less' : 'More'}
          </button>
        </section>

        {error && <p className="flash flash-error" role="status">{error}</p>}
        <div className="btn-row">
          <button
            className="btn primary"
            type="submit"
            disabled={
              busy ||
              (creatingNewNamespace && me.kind === 'ok' && !canCreateNamespace)
            }
          >
            <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />{busy ? 'Creating…' : 'Create repository'}
          </button>
          <Link className="btn ghost" to={cancelTo}>
            <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
          </Link>
        </div>
      </form>
    </main>
  )
}
