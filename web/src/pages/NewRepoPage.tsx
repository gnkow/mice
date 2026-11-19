import { ChevronUp as ActionChevronUp, FolderGit2 as ActionFolderGit2, Plus as ActionPlus, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { DirectoryPicker } from '../components/DirectoryPicker'
import { GroupPrincipalLabel } from '../components/GroupPrincipalLabel'
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
  const [initialCommitMessage, setInitialCommitMessage] = useState(
    'Initialized Repo',
  )
  const [showMore, setShowMore] = useState(false)
  const [collaborators, setCollaborators] = useState<PendingCollaborator[]>(
    [],
  )
  const [collabKind, setCollabKind] = useState<'user' | 'group'>('user')
  const [collabSub, setCollabSub] = useState('')
  const [collabIss, setCollabIss] = useState('mice-dev')
  const [collabGroup, setCollabGroup] = useState('')
  const [collabGroupName, setCollabGroupName] = useState('')
  const [collabRole, setCollabRole] = useState<RepoRole>('read')
  const [approvers, setApprovers] = useState<ApproverPrincipal[]>([])
  const [approverKey, setApproverKey] = useState('')
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
      ...approvers.map((a) => `${a.iss}|${a.sub}`),
    ],
    [userCollaborators, approvers],
  )
  const collabProfiles = usePrincipalProfiles(collabAuthors)

  useEffect(() => {
    setApprovers((prev) =>
      prev.filter((a) =>
        userCollaborators.some((c) => c.sub === a.sub && c.iss === a.iss),
      ),
    )
    setApproverKey((key) => {
      if (!key) return key
      const [iss, sub] = key.split('\0')
      return userCollaborators.some((c) => c.iss === iss && c.sub === sub)
        ? key
        : ''
    })
  }, [userCollaborators])

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

  function addCollaborator() {
    if (collabKind === 'group') {
      const group = collabGroup.trim()
      if (!group) return
      setCollaborators((prev) => {
        const without = prev.filter(
          (c) => !(c.kind === 'group' && c.group === group),
        )
        return [
          ...without,
          {
            kind: 'group',
            group,
            name: collabGroupName.trim() || group,
            role: collabRole,
          },
        ]
      })
      setCollabGroup('')
      setCollabGroupName('')
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
    setCollabIss('mice-dev')
  }

  function removeCollaborator(c: PendingCollaborator) {
    setCollaborators((prev) =>
      prev.filter((x) =>
        c.kind === 'group'
          ? !(x.kind === 'group' && x.group === c.group)
          : !(x.kind === 'user' && x.sub === c.sub && x.iss === c.iss),
      ),
    )
  }

  function addApprover() {
    const [iss, sub] = approverKey.split('\0')
    if (!iss || !sub) return
    if (!userCollaborators.some((c) => c.iss === iss && c.sub === sub)) return
    setApprovers((prev) => {
      if (prev.some((a) => a.iss === iss && a.sub === sub)) return prev
      return [...prev, { iss, sub }]
    })
    setApproverKey('')
  }

  function removeApprover(a: ApproverPrincipal) {
    setApprovers((prev) => prev.filter((x) => !(x.iss === a.iss && x.sub === a.sub)))
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

      const res = await createRepository({
        namespace: ns,
        name: repoName,
        description: desc || undefined,
        initial_commit_message: initialCommitMessage.trim() || 'Initialized Repo',
      })
      const createdNs = res.repository.namespace
      const createdName = res.repository.name

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

          {showMore && (
            <div className="new-repo-more">
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

                <div className="new-repo-add-card">
                  <div className="new-repo-add-kind" role="group" aria-label="Principal type">
                    <button
                      type="button"
                      className={
                        collabKind === 'user'
                          ? 'btn small new-repo-kind-btn is-active'
                          : 'btn ghost small new-repo-kind-btn'
                      }
                      disabled={busy}
                      onClick={() => setCollabKind('user')}
                    >
                      User
                    </button>
                    <button
                      type="button"
                      className={
                        collabKind === 'group'
                          ? 'btn small new-repo-kind-btn is-active'
                          : 'btn ghost small new-repo-kind-btn'
                      }
                      disabled={busy}
                      onClick={() => setCollabKind('group')}
                    >
                      Group
                    </button>
                  </div>
                  {collabKind === 'group' ? (
                    <DirectoryPicker
                      kind="group"
                      group={collabGroup}
                      label={collabGroupName}
                      disabled={busy}
                      onChange={({ group, name }) => {
                        setCollabGroup(group)
                        setCollabGroupName(name)
                      }}
                    />
                  ) : (
                    <DirectoryPicker
                      kind="user"
                      sub={collabSub}
                      iss={collabIss}
                      defaultIss="mice-dev"
                      disabled={busy}
                      onChange={({ sub, iss }) => {
                        setCollabSub(sub)
                        setCollabIss(iss)
                      }}
                    />
                  )}
                  <div className="new-repo-add-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={
                        busy ||
                        (collabKind === 'group'
                          ? !collabGroup.trim()
                          : !collabSub.trim() || !collabIss.trim())
                      }
                      onClick={addCollaborator}
                    >
                      <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />Add
                    </button>
                    <span className="new-repo-add-as" aria-hidden="true">
                      as
                    </span>
                    <label className="new-repo-add-role">
                      <span className="visually-hidden">Role</span>
                      <select
                        value={collabRole}
                        onChange={(e) =>
                          setCollabRole(e.target.value as RepoRole)
                        }
                        disabled={busy}
                        aria-label="Role"
                      >
                        {REPO_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="new-repo-collab new-repo-approvers">
                <div className="new-repo-seat-head">
                  <h3 className="new-repo-subhead">Approvers</h3>
                  <p className="muted small new-repo-seat-lede">
                    Collaborators who can sign merges into validated branches.
                  </p>
                </div>
                {approvers.length > 0 ? (
                  <ul className="ns-member-list new-repo-seat-list">
                    {approvers.map((a) => (
                      <li
                        key={`${a.iss}:${a.sub}`}
                        className="ns-member-row"
                      >
                        <div className="ns-member-main">
                          <UserRef
                            author={`${a.iss}|${a.sub}`}
                            profiles={collabProfiles}
                          />
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
                <div className="new-repo-add-card new-repo-add-actions">
                  <label className="new-repo-approver-pick">
                    Collaborator
                    <select
                      value={approverKey}
                      onChange={(e) => setApproverKey(e.target.value)}
                      disabled={busy || userCollaborators.length === 0}
                    >
                      <option value="">
                        {userCollaborators.length === 0
                          ? 'Add a user collaborator first'
                          : 'Choose a user collaborator…'}
                      </option>
                      {userCollaborators.map((c) => {
                        const key = `${c.iss}\0${c.sub}`
                        const taken = approvers.some(
                          (a) => a.iss === c.iss && a.sub === c.sub,
                        )
                        return (
                          <option key={key} value={key} disabled={taken}>
                            {c.sub}
                            {taken ? ' (already approver)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !approverKey}
                    onClick={addApprover}
                  >
                    <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />Add approver
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
