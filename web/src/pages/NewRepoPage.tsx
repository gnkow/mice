import { ChevronUp as ActionChevronUp, FolderGit2 as ActionFolderGit2, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { GroupPrincipalLabel } from '../components/GroupPrincipalLabel'
import { PrincipalAddCard } from '../components/PrincipalAddCard'
import {
  NamespaceCreateSettings,
  type NamespaceCreateSettingsValue,
} from '../components/NamespaceCreateSettings'
import { UserRef } from '../components/UserRef'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe, hasEffectivePermission } from '../lib/auth'
import {
  createNamespaceAuthz,
  grantApproverSeat,
  listAuthzNamespaces,
  putNamespaceMember,
  putRepoCollaborator,
  type ApproverPrincipal,
  type RepoRole,
} from '../lib/authzApi'
import { createRepository, listNamespaces } from '../lib/oxen/api'
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
  | { kind: 'group'; group: string; name?: string; role: RepoRole }

type PendingBranch = {
  id: string
  name: string
  isDefault: boolean
  validated: boolean
}

const emptyNsSettings = (): NamespaceCreateSettingsValue => ({
  name: '',
  basePermission: 'none',
  membersCanCreateRepos: true,
  members: [],
})

function newBranchRow(partial?: Partial<PendingBranch>): PendingBranch {
  return {
    id: crypto.randomUUID(),
    name: 'main',
    isDefault: true,
    validated: true,
    ...partial,
  }
}

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
  const [initialCommitMessage, setInitialCommitMessage] = useState(
    'Initialized Repo',
  )
  const [branches, setBranches] = useState<PendingBranch[]>(() => [
    newBranchRow({ name: 'main', isDefault: true, validated: true }),
  ])
  const [showMore, setShowMore] = useState(false)
  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>(
    [],
  )
  const [collabRole, setCollabRole] = useState<RepoRole>('read')
  const [approvers, setApprovers] = useState<ApproverPrincipal[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nsDefaulted, setNsDefaulted] = useState(Boolean(presetNs))
  const userCollaborators = useMemo(
    () =>
      collaborators.filter(
        (c): c is Extract<PendingCollaborator, { kind: 'user' }> => c.kind === 'user',
      ),
    [collaborators],
  )
  const collabAuthors = useMemo(
    () => [
      ...userCollaborators.map((c) => `${c.iss}|${c.sub}`),
      ...approvers
        .filter((a): a is Extract<ApproverPrincipal, { kind: 'user' }> => a.kind === 'user')
        .map((a) => `${a.iss}|${a.sub}`),
    ],
    [userCollaborators, approvers],
  )
  const collabProfiles = usePrincipalProfiles(collabAuthors)

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
    hasEffectivePermission(me.data, 'namespace:create')
  const nsFieldsDisabled =
    busy || (me.kind === 'ok' && !canCreateNamespace)

  const cancelTo = presetNs
    ? `/n/${encodeURIComponent(presetNs)}`
    : '/repositories'

  function removeCollaborator(c: PendingCollaborator) {
    setCollaborators((prev) =>
      prev.filter((x) =>
        c.kind === 'group'
          ? !(x.kind === 'group' && x.group === c.group)
          : !(x.kind === 'user' && x.sub === c.sub && x.iss === c.iss),
      ),
    )
  }

  function removeApprover(a: ApproverPrincipal) {
    setApprovers((prev) =>
      prev.filter((x) =>
        a.kind === 'group'
          ? !(x.kind === 'group' && x.group === a.group)
          : !(x.kind === 'user' && x.iss === a.iss && x.sub === a.sub),
      ),
    )
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
            'You need namespace:create permission to create a namespace.',
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

      const branchPlan = branches
        .map((b) => ({
          name: b.name.trim(),
          default: b.isDefault,
          validated: b.validated,
        }))
        .filter((b) => b.name.length > 0)
      // Empty plan → bare create (`branches: []`); omit is not used from this form.
      if (branchPlan.length > 0) {
        if (!branchPlan.some((b) => b.default)) {
          setError('Choose one default branch')
          setBusy(false)
          return
        }
        const names = branchPlan.map((b) => b.name)
        if (new Set(names).size !== names.length) {
          setError('Branch names must be unique')
          setBusy(false)
          return
        }
      }

      const res = await createRepository({
        namespace: ns,
        name: repoName,
        description: desc || undefined,
        initial_commit_message: initialCommitMessage.trim() || 'Initialized Repo',
        branches: branchPlan,
      })
      const createdNs = res.repository.namespace
      const createdName = res.repository.name
      const repoBase = `/n/${encodeURIComponent(createdNs)}/r/${encodeURIComponent(createdName)}`

      try {
        for (const c of collaborators) {
          await putRepoCollaborator(createdNs, createdName, c)
        }
        for (const a of approvers) {
          await grantApproverSeat({ ns: createdNs, repo: createdName }, a)
        }
      } catch {
        // Repo exists; open it even if collaborators / approvers partially failed.
      }

      if (branchPlan.length === 0) {
        navigate(`${repoBase}/branches`)
      } else {
        const defaultBranch =
          branchPlan.find((b) => b.default)?.name ?? branchPlan[0]!.name
        navigate(`${repoBase}/tree/${encodeURIComponent(defaultBranch)}`)
      }
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
                  You need <code>namespace:create</code> to
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
          <label>
            Initial commit message
            <input
              value={initialCommitMessage}
              onChange={(e) => setInitialCommitMessage(e.target.value)}
              placeholder="Initialized Repo"
              autoComplete="off"
              disabled={busy}
            />
          </label>

          {showMore && (
            <div className="new-repo-more">
              <div
                className="new-repo-branches"
                data-testid="new-repo-branches"
              >
                <div className="new-repo-seat-head">
                  <h3 className="new-repo-subhead">Branches</h3>
                  <p className="muted small new-repo-seat-lede">
                    Optional starting branches. Leave empty for a bare repo. Pick one
                    default when you add any. Validated branches only accept signed
                    merges.
                  </p>
                </div>
                {branches.length === 0 ? (
                  <p className="muted small" data-testid="new-repo-branches-empty">
                    No starting branches — create will leave the repository bare.
                  </p>
                ) : (
                  <ul className="new-repo-branch-list" data-testid="new-repo-branch-list">
                    {branches.map((row) => (
                      <li key={row.id} className="new-repo-branch-row">
                        <label className="new-repo-branch-name">
                          <span className="sr-only">Branch name</span>
                          <input
                            value={row.name}
                            onChange={(e) => {
                              const next = e.target.value
                              setBranches((prev) =>
                                prev.map((b) =>
                                  b.id === row.id ? { ...b, name: next } : b,
                                ),
                              )
                            }}
                            placeholder="branch-name"
                            autoComplete="off"
                            pattern="[A-Za-z0-9._/-]+"
                            title="Letters, numbers, dots, underscores, hyphens, slashes"
                            disabled={busy}
                            required
                          />
                        </label>
                        <label className="new-repo-branch-flag">
                          <input
                            type="radio"
                            name="new-repo-default-branch"
                            checked={row.isDefault}
                            disabled={busy}
                            onChange={() => {
                              setBranches((prev) =>
                                prev.map((b) => ({
                                  ...b,
                                  isDefault: b.id === row.id,
                                })),
                              )
                            }}
                          />
                          Default
                        </label>
                        <label className="new-repo-branch-flag">
                          <input
                            type="checkbox"
                            checked={row.validated}
                            disabled={busy}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setBranches((prev) =>
                                prev.map((b) =>
                                  b.id === row.id ? { ...b, validated: checked } : b,
                                ),
                              )
                            }}
                          />
                          Validated
                        </label>
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy}
                          aria-label={`Remove branch ${row.name || 'row'}`}
                          onClick={() => {
                            setBranches((prev) => {
                              const next = prev.filter((b) => b.id !== row.id)
                              if (
                                next.length > 0 &&
                                !next.some((b) => b.isDefault)
                              ) {
                                next[0] = { ...next[0]!, isDefault: true }
                              }
                              return next
                            })
                          }}
                        >
                          <ActionTrash2
                            size={14}
                            aria-hidden="true"
                            className="button-label-icon"
                          />
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  data-testid="new-repo-add-branch"
                  onClick={() =>
                    setBranches((prev) => [
                      ...prev,
                      newBranchRow({
                        name: '',
                        isDefault: prev.length === 0,
                        validated: false,
                      }),
                    ])
                  }
                >
                  Add branch
                </button>
              </div>

              <div className="new-repo-collab">
                <div className="new-repo-seat-head">
                  <h3 className="new-repo-subhead">Collaborators</h3>
                  <p className="muted small new-repo-seat-lede">
                    Only this list can read or write repository data.
                  </p>
                </div>
                {collaborators.length > 0 ? (
                  <ul className="ns-member-list new-repo-seat-list">
                    {collaborators.map((c) => (
                      <li
                        key={
                          c.kind === 'group'
                            ? `group:${c.group}`
                            : `${c.iss}:${c.sub}`
                        }
                        className="ns-member-row"
                      >
                        <div className="ns-member-main">
                          {c.kind === 'group' ? (
                            <GroupPrincipalLabel
                              group={c.group}
                              name={c.name}
                              inline
                            />
                          ) : (
                            <UserRef
                              author={`${c.iss}|${c.sub}`}
                              profiles={collabProfiles}
                            />
                          )}
                        </div>
                        <span className="ns-tag">{c.role}</span>
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => removeCollaborator(c)}
                        >
                          <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No collaborators yet.</p>
                )}

                <PrincipalAddCard
                  disabled={busy}
                  role={collabRole}
                  onRoleChange={(r) => setCollabRole(r as RepoRole)}
                  roles={REPO_ROLES.map((r) => ({ value: r, label: r }))}
                  onAdd={(principal) => {
                    if (principal.kind === 'group') {
                      setCollaborators((prev) => {
                        const without = prev.filter(
                          (c) =>
                            !(c.kind === 'group' && c.group === principal.group),
                        )
                        return [
                          ...without,
                          {
                            kind: 'group',
                            group: principal.group,
                            name: principal.name,
                            role: collabRole,
                          },
                        ]
                      })
                      return
                    }
                    setCollaborators((prev) => {
                      const without = prev.filter(
                        (c) =>
                          !(
                            c.kind === 'user' &&
                            c.sub === principal.sub &&
                            c.iss === principal.iss
                          ),
                      )
                      return [
                        ...without,
                        {
                          kind: 'user',
                          sub: principal.sub,
                          iss: principal.iss,
                          role: collabRole,
                        },
                      ]
                    })
                  }}
                />
              </div>

              <div className="new-repo-collab new-repo-approvers">
                <div className="new-repo-seat-head">
                  <h3 className="new-repo-subhead">Approvers</h3>
                  <p className="muted small new-repo-seat-lede">
                    Users or groups who can sign merges into validated branches.
                  </p>
                </div>
                {approvers.length > 0 ? (
                  <ul className="ns-member-list new-repo-seat-list">
                    {approvers.map((a) => (
                      <li
                        key={
                          a.kind === 'group'
                            ? `group:${a.group}`
                            : `user:${a.iss}|${a.sub}`
                        }
                        className="ns-member-row"
                      >
                        <div className="ns-member-main">
                          {a.kind === 'group' ? (
                            <GroupPrincipalLabel
                              group={a.group}
                              name={a.name}
                              inline
                            />
                          ) : (
                            <UserRef
                              author={`${a.iss}|${a.sub}`}
                              profiles={collabProfiles}
                            />
                          )}
                        </div>
                        <span className="ns-tag">approver</span>
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => removeApprover(a)}
                        >
                          <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No approvers yet.</p>
                )}
                <PrincipalAddCard
                  disabled={busy}
                  addLabel="Add approver"
                  onAdd={(principal) => {
                    if (principal.kind === 'group') {
                      setApprovers((prev) => {
                        if (prev.some((a) => a.kind === 'group' && a.group === principal.group)) {
                          return prev
                        }
                        return [
                          ...prev,
                          {
                            kind: 'group',
                            group: principal.group,
                            name: principal.name,
                          },
                        ]
                      })
                      return
                    }
                    setApprovers((prev) => {
                      if (
                        prev.some(
                          (a) =>
                            a.kind === 'user' &&
                            a.sub === principal.sub &&
                            a.iss === principal.iss,
                        )
                      ) {
                        return prev
                      }
                      return [
                        ...prev,
                        {
                          kind: 'user',
                          sub: principal.sub,
                          iss: principal.iss,
                        },
                      ]
                    })
                  }}
                />
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
