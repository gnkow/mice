import { GitBranch as ActionGitBranch, X as ActionX } from 'lucide-react'
import { ArrowLeftRight, FolderOpen, History, Tags, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { AuthorAvatar } from '../components/AuthorAvatar'
import { CommitEmail, useCurrentEmails } from '../components/CommitEmail'
import { CommitSelector } from '../components/CommitSelector'
import { Modal } from '../components/Modal'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import {
  compareCommits,
  createBranch,
  deleteBranch,
  getCommit,
  listBranches,
  updateBranch,
} from '../lib/oxen/api'
import type { Commit } from '../lib/oxen/types'
import { OxenApiError } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'
import { ListToolbar } from '../components/ListToolbar'
import { useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import { FavoriteStar } from '../components/FavoriteStar'

type SourceType = 'branch' | 'commit'

type BranchMeta = {
  commit?: Commit
  ahead: number | null
}

function BranchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M5 3.25a1.75 1.75 0 1 1-1.5 2.8v1.4A2.75 2.75 0 0 0 6.25 10.2h1.9v-.95a1.75 1.75 0 1 1 1.5 0v.95h1.1A2.75 2.75 0 0 0 13.5 7.45V5.95a1.75 1.75 0 1 1 1.5 0v1.5A4.25 4.25 0 0 1 10.75 11.7H9.65v1.05a1.75 1.75 0 1 1-1.5 0V11.7H6.25A4.25 4.25 0 0 1 2 7.45V6.05a1.75 1.75 0 0 1 3-1.8Z"
      />
    </svg>
  )
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M6.5 1.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5H13v8.25A1.75 1.75 0 0 1 11.25 14.5h-6.5A1.75 1.75 0 0 1 3 12.75V4.5h.25A.75.75 0 0 1 3.25 3H6.5V1.75Zm-2 2.75v8.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V4.5H4.5Zm2 1.75a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0v-5Zm3 0a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0v-5Z"
      />
    </svg>
  )
}

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M4.5 2.75A1.75 1.75 0 0 1 6.25 1h5A1.75 1.75 0 0 1 13 2.75v7.5A1.75 1.75 0 0 1 11.25 12H6.25A1.75 1.75 0 0 1 4.5 10.25v-7.5Zm1.5 0v7.5c0 .138.112.25.25.25h5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-5a.25.25 0 0 0-.25.25ZM2.75 5a.75.75 0 0 0 0 1.5H3.5v5.25A1.75 1.75 0 0 0 5.25 13.5h5a.75.75 0 0 0 0-1.5h-5a.25.25 0 0 1-.25-.25V6.5h.75A.75.75 0 0 0 6.5 5H2.75Z"
      />
    </svg>
  )
}

export function BranchesPage() {
  const { namespace = '', repo = '' } = useParams()
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [fromName, setFromName] = useState('main')
  const [sourceType, setSourceType] = useState<SourceType>('branch')
  const [fromCommit, setFromCommit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [metaByName, setMetaByName] = useState<Record<string, BranchMeta>>({})
  const emails = useCurrentEmails(Object.values(metaByName).map((m) => m.commit?.author ?? ''))

  const branchList = branches.kind === 'ok' ? branches.data.branches : []
  const branchNames = useMemo(
    () => branchList.map((b) => b.name),
    [branchList],
  )
  const defaultBranch = useMemo(
    () => resolveDefaultBranch(branchNames, namespace, repo),
    [branchNames, namespace, repo],
  )

  useEffect(() => {
    if (branchNames.length === 0) return
    setFromName((prev) => (branchNames.includes(prev) ? prev : defaultBranch))
  }, [branchNames, defaultBranch])

  const branchTipsKey = useMemo(
    () => branchList.map((b) => `${b.name}:${b.commit_id}`).join('|'),
    [branchList],
  )

  useEffect(() => {
    if (branches.kind !== 'ok') return
    const list = branches.data.branches
    if (list.length === 0) {
      setMetaByName({})
      return
    }
    const controller = new AbortController()
    const defaultTip =
      list.find((b) => b.name === defaultBranch)?.commit_id ?? ''

    void (async () => {
      const next: Record<string, BranchMeta> = {}
      await Promise.all(
        list.map(async (b) => {
          let commit: Commit | undefined
          try {
            const res = await getCommit(
              namespace,
              repo,
              b.commit_id,
              controller.signal,
            )
            commit = res.commit
          } catch {
            commit = undefined
          }

          let ahead: number | null = 0
          if (b.name === defaultBranch) {
            ahead = 0
          } else if (defaultTip && b.commit_id === defaultTip) {
            ahead = 0
          } else if (defaultTip) {
            try {
              const cmp = await compareCommits(
                namespace,
                repo,
                defaultBranch,
                b.name,
                controller.signal,
              )
              ahead = cmp.compare.commits?.length ?? 0
            } catch {
              ahead = null
            }
          } else {
            ahead = null
          }

          next[b.name] = { commit, ahead }
        }),
      )
      if (!controller.signal.aborted) setMetaByName(next)
    })()

    return () => controller.abort()
    // branchTipsKey captures name+tip identity; avoid depending on branches object identity
  }, [branchTipsKey, branches.kind, defaultBranch, namespace, repo])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return branchList
    return branchList.filter((b) => b.name.toLowerCase().includes(needle))
  }, [branchList, filter])

  const branchSortFields = useMemo<SortFields<(typeof branchList)[number]>>(
    () => ({ name: (b) => b.name, created: (b) => metaByName[b.name]?.commit?.timestamp }),
    [metaByName],
  )
  const sort = useListSort('branches', branchSortFields)
  const favs = useFavorites()
  const ordered = useMemo(
    () => sort.apply(filtered, (b) => favs.has('branch', `${namespace}/${repo}@${b.name}`)),
    [filtered, sort.apply, favs, namespace, repo],
  )

  const nameValid = newName.trim().length >= 2
  const nameTaken = branchNames.includes(newName.trim())
  const commitOk = sourceType !== 'commit' || fromCommit.length > 0
  const canCreate = nameValid && !nameTaken && commitOk && !busy

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      branches.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Action failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!canCreate) return
    void run(async () => {
      if (sourceType === 'commit') {
        const name = newName.trim()
        await createBranch(namespace, repo, name, fromName.trim() || defaultBranch)
        await updateBranch(namespace, repo, name, fromCommit)
      } else {
        await createBranch(
          namespace,
          repo,
          newName.trim(),
          fromName.trim() || defaultBranch,
        )
      }
      setNewName('')
      setFromCommit('')
      setSourceType('branch')
      setFromName(defaultBranch)
      setCreateOpen(false)
    })
  }

  async function onDelete(name: string) {
    if (name === defaultBranch) return
    if (
      !(await confirmDelete({
        title: `Delete branch ${name}`,
        detail: `Branch “${name}” will be removed from ${namespace}/${repo}. Commits may become unreachable.`,
        confirmWord: name,
      }))
    ) {
      return
    }
    void run(async () => {
      await deleteBranch(namespace, repo, name)
    })
  }

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name)
      setCopied(name)
      window.setTimeout(
        () => setCopied((cur) => (cur === name ? null : cur)),
        1500,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy branch name')
    }
  }

  const basePath = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  return (
    <main className="page branches-page">
      <BranchesSubNav />
      <div className="branches-page-head">
        <div>
          <h1 className="branches-title">Branches</h1>
          <p className="lede">
            Maintain multiple versions of your data, without stepping on each
            other&apos;s toes.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setCreateOpen(true)}
        >
          <ActionGitBranch size={14} aria-hidden="true" className="button-label-icon" />New branch
        </button>
      </div>

      <ListToolbar
        id="branches"
        sort={sort}
        search={{ value: filter, onChange: setFilter, placeholder: 'Filter branches…', disabled: branches.kind !== 'ok' }}
      />

      <StateBlock
        loading={branches.kind === 'loading'}
        error={branches.kind === 'error' ? branches.message : null}
        empty={branches.kind === 'ok' && branchList.length === 0}
        emptyMessage="No branches yet."
      >
        {branches.kind === 'ok' && (
          <div className="branches-table-wrap">
            {filtered.length === 0 ? (
              <p className="muted">No matching branches.</p>
            ) : (
              <table className="branches-table">
                <thead>
                  <tr>
                    <th scope="col">Branch</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Commits ahead</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((b) => {
                    const isDefault = b.name === defaultBranch
                    const meta = metaByName[b.name]
                    const ahead = meta?.ahead
                    const commit = meta?.commit
                    const compareHref = `${basePath}/compare?base=${encodeURIComponent(defaultBranch)}&head=${encodeURIComponent(b.name)}`
                    const treeHref = `${basePath}/tree/${encodeURIComponent(b.name)}`
                    const branchHref = `${basePath}/branches/${encodeURIComponent(b.name)}`

                    return (
                      <tr
                        key={b.name}
                        data-branch={b.name}
                        data-commit-id={b.commit_id}
                      >
                        <td className="branches-col-name">
                          <div className="branch-title-row">
                            <FavoriteStar type="branch" id={`${namespace}/${repo}@${b.name}`} label={b.name} />
                            <Link className="branch-pill" to={branchHref}>
                              <BranchIcon />
                              <span className="mono">{b.name}</span>
                            </Link>
                            {isDefault && (
                              <span className="pill default-branch">
                                default
                              </span>
                            )}
                            <button
                              type="button"
                              className="icon-round branch-copy"
                              title={
                                copied === b.name
                                  ? 'Copied'
                                  : 'Copy branch name'
                              }
                              aria-label={
                                copied === b.name
                                  ? `Copied ${b.name}`
                                  : `Copy branch name ${b.name}`
                              }
                              onClick={() => void copyName(b.name)}
                            >
                              <CopyIcon size={12} />
                            </button>
                          </div>
                        </td>
                        <td
                          className="branches-col-updated"
                          title={
                            commit
                              ? `${commit.message}\n${b.commit_id}`
                              : b.commit_id
                          }
                        >
                          {commit ? (
                            <div className="branch-updated">
                              <AuthorAvatar
                                name={commit.author || 'unknown'}
                              />
                              <div className="branch-updated-text">
                                <span className="branch-updated-author">
                                  {commit.author || 'unknown'}
                                  <CommitEmail author={commit.author} stored={commit.email} emails={emails} />
                                </span>
                                <span
                                  className="branch-updated-time muted"
                                  title={commit.timestamp}
                                >
                                  {formatRelativeTime(commit.timestamp)}
                                </span>
                              </div>
                              <span className="sr-only mono">
                                {b.commit_id.slice(0, 12)}
                              </span>
                            </div>
                          ) : (
                            <span className="mono muted" title={b.commit_id}>
                              {b.commit_id.slice(0, 12)}
                            </span>
                          )}
                        </td>
                        <td className="branches-col-ahead">
                          {isDefault ? (
                            <span className="muted">—</span>
                          ) : ahead === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <span>{ahead}</span>
                          )}
                        </td>
                        <td className="branches-col-actions">
                          <div className="branch-row-actions">
                            <Link
                              className="icon-round"
                              to={`${basePath}/commits?branch=${encodeURIComponent(b.name)}`}
                              aria-label={`History for ${b.name}`}
                              title={`History for ${b.name}`}
                            >
                              <History size={14} aria-hidden />
                            </Link>
                            <Link
                              className="icon-round"
                              to={treeHref}
                              aria-label={`Browse files on ${b.name}`}
                              title={`Browse files on ${b.name}`}
                            >
                              <FolderOpen size={14} aria-hidden />
                            </Link>
                            <Link
                              className="icon-round"
                              to={`${branchHref}#metadata`}
                              aria-label={`Metadata for ${b.name}`}
                              title={`View or edit metadata for ${b.name}`}
                            >
                              <Tags size={14} aria-hidden />
                            </Link>
                            {!isDefault && (
                              <Link
                                className="icon-round"
                                to={compareHref}
                                aria-label={`Compare ${b.name} with ${defaultBranch}`}
                                title={`Compare ${b.name} with ${defaultBranch}`}
                              >
                                <ArrowLeftRight size={14} aria-hidden />
                              </Link>
                            )}
                            <Link
                              className="icon-round"
                              to={`${branchHref}#power-tools`}
                              aria-label={`Power tools for ${b.name}`}
                              title={`Power tools for ${b.name}`}
                            >
                              <Wrench size={14} aria-hidden />
                            </Link>
                            <button
                              type="button"
                              className="icon-round branch-delete"
                              disabled={busy || isDefault}
                              title={
                                isDefault
                                  ? 'You cannot delete your default branch'
                                  : `Delete ${b.name}`
                              }
                              aria-label={
                                isDefault
                                  ? 'Cannot delete default branch'
                                  : `Delete branch ${b.name}`
                              }
                              onClick={() => void onDelete(b.name)}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </StateBlock>

      {createOpen && (
        <Modal title="Create a branch" onClose={() => setCreateOpen(false)}>
          <form className="form" onSubmit={onCreate}>
            <label>
              Branch name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
                minLength={2}
                name="branch-name"
                aria-invalid={newName.length > 0 && !nameValid}
              />
            </label>
            {newName.length > 0 && !nameValid && (
              <p className="field-hint error-text">at least 2 characters</p>
            )}
            {nameTaken && (
              <p className="field-hint error-text">Branch already exists</p>
            )}
            <label>
              Source type
              <select
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value as SourceType)
                  setFromCommit('')
                }}
                aria-label="Source type"
              >
                <option value="branch">Branch</option>
                <option value="commit">Commit</option>
              </select>
            </label>
            <label>
              {sourceType === 'commit' ? 'Branch to pick the commit from' : 'Source branch'}
              <select
                value={fromName}
                onChange={(e) => {
                  setFromName(e.target.value)
                  setFromCommit('')
                }}
                required
                aria-label={sourceType === 'commit' ? 'Commit branch' : 'Source branch'}
              >
                {branchNames.length > 0 ? (
                  branchNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                ) : (
                  <option value={fromName}>{fromName}</option>
                )}
              </select>
            </label>
            {sourceType === 'commit' && (
              <CommitSelector
                namespace={namespace}
                repo={repo}
                branch={fromName}
                value={fromCommit}
                onChange={setFromCommit}
                label="Commit"
              />
            )}
            <div className="btn-row modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCreateOpen(false)}
              >
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
              </button>
              <button className="btn primary" type="submit" disabled={!canCreate}>
                <ActionGitBranch size={14} aria-hidden="true" className="button-label-icon" />Create branch
              </button>
            </div>
          </form>
        </Modal>
      )}

      {error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
