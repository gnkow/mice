import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuthorAvatar } from '../components/AuthorAvatar'
import { Modal } from '../components/Modal'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import {
  pickOtherBranch,
  resolveDefaultBranch,
} from '../lib/lastBranch'
import {
  compareCommits,
  createBranch,
  deleteBranch,
  getCommit,
  listBranches,
  mergeCommitIntoBranch,
  updateBranch,
} from '../lib/oxen/api'
import type { Commit } from '../lib/oxen/types'
import { OxenApiError } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

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
  const [updateBranchName, setUpdateBranchName] = useState('')
  const [commitId, setCommitId] = useState('')
  const [mergeBranch, setMergeBranch] = useState('main')
  const [clientCommitId, setClientCommitId] = useState('')
  const [serverCommitId, setServerCommitId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [metaByName, setMetaByName] = useState<Record<string, BranchMeta>>({})

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
    setFromName((prev) =>
      branchNames.includes(prev) ? prev : defaultBranch,
    )
    setMergeBranch((prev) =>
      branchNames.includes(prev) ? prev : defaultBranch,
    )
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

  const nameValid = newName.trim().length >= 2
  const nameTaken = branchNames.includes(newName.trim())
  const canCreate = nameValid && !nameTaken && !busy

  function tipFor(name: string) {
    return branchList.find((b) => b.name === name)?.commit_id ?? ''
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
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
      await createBranch(
        namespace,
        repo,
        newName.trim(),
        fromName.trim() || defaultBranch,
      )
      setNewName('')
      setCreateOpen(false)
    })
  }

  function onUpdate(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await updateBranch(
        namespace,
        repo,
        updateBranchName.trim(),
        commitId.trim(),
      )
      setCommitId('')
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
    } catch {
      setCopied(null)
    }
  }

  const basePath = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const otherForMerge =
    pickOtherBranch(branchNames, defaultBranch) || defaultBranch

  return (
    <main className="page branches-page">
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
          New branch
        </button>
      </div>

      <div className="branches-toolbar">
        <label className="branches-filter-label">
          <span className="sr-only">Filter branches</span>
          <input
            type="search"
            className="branches-filter"
            placeholder="Filter branches…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={branches.kind !== 'ok'}
          />
        </label>
      </div>

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
                  {filtered.map((b) => {
                    const isDefault = b.name === defaultBranch
                    const meta = metaByName[b.name]
                    const ahead = meta?.ahead
                    const canMerge =
                      !isDefault && typeof ahead === 'number' && ahead > 0
                    const commit = meta?.commit
                    const mergeHref = `${basePath}/merge?base=${encodeURIComponent(defaultBranch)}&head=${encodeURIComponent(b.name)}`
                    const compareHref = `${basePath}/compare?base=${encodeURIComponent(defaultBranch)}&head=${encodeURIComponent(b.name)}`
                    const treeHref = `${basePath}/tree/${encodeURIComponent(b.name)}`

                    return (
                      <tr
                        key={b.name}
                        data-branch={b.name}
                        data-commit-id={b.commit_id}
                      >
                        <td className="branches-col-name">
                          <div className="branch-title-row">
                            <Link className="branch-pill" to={treeHref}>
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
                            {!isDefault && (
                              <Link
                                className="btn ghost branch-compare-btn"
                                to={compareHref}
                                title={`Compare ${b.name} with ${defaultBranch}`}
                              >
                                Compare
                              </Link>
                            )}
                            {isDefault ? (
                              <button
                                type="button"
                                className="btn ghost branch-mr-btn"
                                disabled
                                title="Default branch cannot open a merge request against itself"
                              >
                                Create merge request
                              </button>
                            ) : (
                              <Link
                                className={`btn ghost branch-mr-btn${canMerge ? '' : ' is-disabled'}`}
                                to={canMerge ? mergeHref : '#'}
                                aria-disabled={!canMerge}
                                tabIndex={canMerge ? undefined : -1}
                                onClick={(e) => {
                                  if (!canMerge) e.preventDefault()
                                }}
                                title={
                                  canMerge
                                    ? `Merge ${b.name} into ${defaultBranch}`
                                    : ahead === 0
                                      ? `No commits ahead of ${defaultBranch}`
                                      : 'Checking divergence…'
                                }
                              >
                                Create merge request
                              </Link>
                            )}
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
              Source
              <select
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                required
                aria-label="Source"
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
            <div className="btn-row modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={!canCreate}>
                Create branch
              </button>
            </div>
          </form>
        </Modal>
      )}

      <details className="panel branches-power-tools">
        <summary className="section-label" style={{ cursor: 'pointer' }}>
          Power tools
        </summary>
        <p className="muted small">
          Point a tip at a commit, or use the push-path merge. For branch merges
          prefer{' '}
          <Link
            to={`${basePath}/merge?base=${encodeURIComponent(defaultBranch)}&head=${encodeURIComponent(otherForMerge)}`}
          >
            Merge
          </Link>
          .
        </p>

        <h3 className="subhead">Point branch at commit</h3>
        <form className="form" onSubmit={onUpdate}>
          <label>
            Branch
            <input
              value={updateBranchName}
              onChange={(e) => setUpdateBranchName(e.target.value)}
              placeholder="dev"
              required
            />
          </label>
          <label>
            Commit ID
            <input
              value={commitId}
              onChange={(e) => setCommitId(e.target.value)}
              required
            />
          </label>
          <button className="btn ghost" type="submit" disabled={busy}>
            Update tip
          </button>
        </form>

        <h3 className="subhead">Merge commit into branch</h3>
        <p className="muted">
          Push-path merge: combine an incoming (client) commit with the branch
          tip (server). On conflict the server tip is unchanged.
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const server =
                serverCommitId.trim() || tipFor(mergeBranch.trim())
              if (!server) throw new Error('Server commit id is required')
              const res = await mergeCommitIntoBranch(
                namespace,
                repo,
                mergeBranch.trim(),
                clientCommitId.trim(),
                server,
              )
              setInfo(
                `Branch tip after merge: ${res.commit.id.slice(0, 12)} — ${res.commit.message}`,
              )
              setClientCommitId('')
            })
          }}
        >
          <label>
            Branch
            <select
              value={mergeBranch}
              onChange={(e) => {
                setMergeBranch(e.target.value)
                setServerCommitId(tipFor(e.target.value))
              }}
            >
              {branchNames.length > 0 ? (
                branchNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              ) : (
                <option value={mergeBranch}>{mergeBranch}</option>
              )}
            </select>
          </label>
          <label>
            Client commit (incoming)
            <input
              value={clientCommitId}
              onChange={(e) => setClientCommitId(e.target.value)}
              placeholder="commit id to merge in"
              required
              className="mono"
            />
          </label>
          <label>
            Server commit (branch tip)
            <input
              value={serverCommitId || tipFor(mergeBranch)}
              onChange={(e) => setServerCommitId(e.target.value)}
              placeholder="defaults to branch tip"
              className="mono"
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Merge into branch
          </button>
        </form>
      </details>

      {info && <p className="flash flash-success" role="status">{info}</p>}
      {error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
