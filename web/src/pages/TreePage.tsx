import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthorAvatar } from '../components/AuthorAvatar'
import { BranchSwitcher } from '../components/BranchSwitcher'
import { FileIcon } from '../components/FileIcon'
import { DataTypeIcon, RestoreIcon } from '../components/icons'
import { ManageFilesMenu } from '../components/ManageFilesMenu'
import { Markdown } from '../components/Markdown'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  copyFile,
  deleteFile,
  downloadFile,
  downloadFileText,
  getRepository,
  listAllCommits,
  listBranches,
  listDeletedInLatestCommit,
  listDirectory,
  moveFile,
  restoreFile,
  triggerDownload,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { formatBytes } from '../lib/oxen/client'
import {
  lastBranch,
  rememberBranch,
  resolveDefaultBranch,
} from '../lib/lastBranch'
import {
  baseName,
  isRenamePathChange,
  joinPath,
  looksLikeCommitId,
  parentPath,
} from '../lib/oxen/paths'
import { OxenApiError } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

function findReadme(names: string[]): string | null {
  const lower = names.map((n) => n.toLowerCase())
  for (const candidate of ['readme.md', 'readme.markdown', 'readme']) {
    const i = lower.indexOf(candidate)
    if (i >= 0) return names[i]
  }
  return null
}

/** Oxen returns this when the revision/branch does not exist yet (empty repo). */
function isMissingRevisionError(message: string): boolean {
  return /could not find path/i.test(message)
}

export function TreePage() {
  const { namespace = '', repo = '', branch = 'main', '*': splat } = useParams()
  const path = splat ?? ''
  const navigate = useNavigate()

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const repoDetail = useAsync(
    (signal) => getRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const listing = useAsync(
    (signal) => listDirectory(namespace, repo, branch, path, signal),
    [namespace, repo, branch, path],
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [mutateTick, setMutateTick] = useState(0)
  const [pathChange, setPathChange] = useState<{
    mode: 'rename' | 'move' | 'copy'
    from: string
  } | null>(null)
  const [pathChangeTo, setPathChangeTo] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [sortAsc, setSortAsc] = useState(true)
  const [showFilter, setShowFilter] = useState(false)

  const treeKey = `${namespace}/${repo}/${branch}/${path}`
  const [seenTree, setSeenTree] = useState(treeKey)
  if (seenTree !== treeKey) {
    setSeenTree(treeKey)
    setNameFilter('')
  }

  const commits = useAsync(
    (signal) => listAllCommits(namespace, repo, signal),
    [namespace, repo],
  )

  useEffect(() => {
    rememberBranch(namespace, repo, branch)
  }, [namespace, repo, branch])

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean)
    const items: { label: string; to: string }[] = [
      {
        label: repo,
        to: `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}`,
      },
    ]
    let acc = ''
    for (const part of parts) {
      acc = joinPath(acc, part)
      items.push({
        label: part,
        to: `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}/${acc}`,
      })
    }
    return items
  }, [namespace, repo, branch, path])

  const readmeName = useMemo(() => {
    if (path || listing.kind !== 'ok') return null
    return findReadme(
      listing.data.entries.filter((e) => !e.is_dir).map((e) => e.filename),
    )
  }, [path, listing])

  const readme = useAsync(
    async (signal) => {
      if (!readmeName) return null
      return downloadFileText(namespace, repo, branch, readmeName, signal)
    },
    [namespace, repo, branch, readmeName ?? ''],
  )

  function goBranch(next: string) {
    const suffix = path ? `/${path}` : ''
    navigate(
      `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(next)}${suffix}`,
    )
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
      listing.reload()
      branches.reload()
      setMutateTick((t) => t + 1)
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

  async function onDelete(entryPath: string, isDir: boolean) {
    if (onCommitRef) {
      setError('Delete requires a branch tip. Switch to a branch first.')
      return
    }
    const label = isDir ? `directory ${entryPath}/` : `file ${entryPath}`
    if (
      !(await confirmDelete({
        title: `Delete ${label}`,
        detail: isDir
          ? `All files and subdirectories under “${entryPath}” on branch “${writeBranch}” will be removed in a new commit.`
          : `“${entryPath}” on branch “${writeBranch}” will be removed in a new commit.`,
        requireTypedConfirm: false,
      }))
    ) {
      return
    }
    void run(async () => {
      await deleteFile(
        namespace,
        repo,
        writeBranch,
        entryPath,
        `Delete ${entryPath}`,
      )
    })
  }

  function openPathChange(
    mode: 'rename' | 'move' | 'copy',
    entryPath: string,
  ) {
    for (const el of document.querySelectorAll('.row-more[open]')) {
      el.removeAttribute('open')
    }
    setPathChange({ mode, from: entryPath })
    if (mode === 'rename') {
      setPathChangeTo(baseName(entryPath))
    } else if (mode === 'copy') {
      setPathChangeTo(joinPath('copy', baseName(entryPath)))
    } else {
      setPathChangeTo(entryPath)
    }
    setError(null)
    setInfo(null)
  }

  function closePathChange() {
    setPathChange(null)
    setPathChangeTo('')
  }

  function onPathChangeSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pathChange) return
    const from = pathChange.from
    let next =
      pathChange.mode === 'rename'
        ? joinPath(parentPath(from), pathChangeTo.trim())
        : pathChangeTo.trim().replace(/^\/+/, '')
    if (!next || next === from) {
      setError(
        pathChange.mode === 'rename'
          ? 'Enter a new file name.'
          : 'Enter a different destination path.',
      )
      return
    }
    if (pathChange.mode === 'rename' && !isRenamePathChange(from, next)) {
      setError('Rename must keep the same folder; only change the file name.')
      return
    }
    if (pathChange.mode === 'copy' && baseName(from) !== baseName(next)) {
      setError('Copy must keep the same file name; only change the folder.')
      return
    }
    if (pathChange.mode === 'move' && isRenamePathChange(from, next)) {
      // Same-folder target: treat as rename for the commit message / UX.
      // BFF lineage will classify as rename from path geometry either way.
    }

    if (pathChange.mode === 'copy') {
      if (looksLikeCommitId(writeBranch)) {
        setError('Select a branch before copying (current view is a commit).')
        return
      }
      const message = `Copy ${from} → ${next}`
      void run(async () => {
        await copyFile(namespace, repo, branch, from, next, message, undefined, {
          targetBranch: writeBranch,
        })
        closePathChange()
        setInfo(
          onCommitRef
            ? `Copied to ${next} on branch ${writeBranch}.`
            : `Copied to ${next}.`,
        )
        if (onCommitRef) {
          navigate(
            `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(writeBranch)}${path ? `/${path}` : ''}`,
          )
        }
      })
      return
    }

    if (onCommitRef) {
      setError(
        'Rename and move require a branch tip. Switch to a branch first.',
      )
      return
    }

    const kind = isRenamePathChange(from, next) ? 'rename' : 'move'
    const message =
      kind === 'rename'
        ? `Rename ${baseName(from)} → ${baseName(next)}`
        : `Move ${from} → ${next}`
    void run(async () => {
      await moveFile(namespace, repo, writeBranch, from, next, message)
      closePathChange()
      setInfo(
        kind === 'rename'
          ? `Renamed to ${baseName(next)}.`
          : `Moved to ${next}.`,
      )
    })
  }

  const latestCommit = useMemo(() => {
    if (listing.kind !== 'ok') return null
    let best: (typeof listing.data.entries)[number]['latest_commit'] = null
    for (const entry of listing.data.entries) {
      const commit = entry.latest_commit
      if (!commit?.timestamp) continue
      if (
        !best?.timestamp ||
        new Date(commit.timestamp).getTime() > new Date(best.timestamp).getTime()
      ) {
        best = commit
      }
    }
    return best ?? null
  }, [listing])

  const commitCount =
    commits.kind === 'ok'
      ? (commits.data.total_entries ?? commits.data.commits.length)
      : null

  const visibleEntries = useMemo(() => {
    if (listing.kind !== 'ok') return []
    const q = nameFilter.trim().toLowerCase()
    const filtered = listing.data.entries.filter((entry) =>
      entry.filename.toLowerCase().includes(q),
    )
    return [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      const cmp = a.filename.localeCompare(b.filename)
      return sortAsc ? cmp : -cmp
    })
  }, [listing, nameFilter, sortAsc])

  const branchNames =
    branches.kind === 'ok'
      ? branches.data.branches.map((b) => b.name)
      : looksLikeCommitId(branch)
        ? []
        : [branch]

  /** URL ref may be a commit hash; mutations must target a real branch. */
  const onCommitRef = looksLikeCommitId(branch)
  const writeBranch = onCommitRef
    ? resolveDefaultBranch(
        branchNames.length > 0
          ? branchNames
          : [lastBranch(namespace, repo, 'main')].filter(
              (b) => !looksLikeCommitId(b),
            ),
        namespace,
        repo,
      )
    : branch

  /** Files removed in the viewed revision (vs its parent) in this directory. */
  const deletedHint = useAsync(
    async (signal) => {
      try {
        return await listDeletedInLatestCommit(
          namespace,
          repo,
          branch,
          path,
          signal,
        )
      } catch {
        return []
      }
    },
    [namespace, repo, branch, path, mutateTick],
  )

  const deletedEntries =
    deletedHint.kind === 'ok'
      ? deletedHint.data.filter((d) =>
          d.filename.toLowerCase().includes(nameFilter.trim().toLowerCase()),
        )
      : []

  function onRestoreDeleted(entryPath: string, sourceRevision: string) {
    if (looksLikeCommitId(writeBranch)) {
      setError('Select a branch before restoring.')
      return
    }
    void run(async () => {
      await restoreFile(
        namespace,
        repo,
        writeBranch,
        entryPath,
        sourceRevision,
        `Restore ${entryPath}`,
      )
      setInfo(`Restored “${entryPath}” on ${writeBranch}.`)
      // Historical commit trees stay frozen; jump to the branch tip so the
      // restored file appears in the listing.
      if (onCommitRef) {
        const suffix = path ? `/${path}` : ''
        navigate(
          `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(writeBranch)}${suffix}`,
        )
      } else {
        deletedHint.reload()
      }
    })
  }

  const hasDeleted = deletedEntries.length > 0
  const deletedPending = deletedHint.kind === 'loading'

  const looksUninitialized =
    (repoDetail.kind === 'ok' && repoDetail.data.repository.is_empty) ||
    (listing.kind === 'error' &&
      !path &&
      isMissingRevisionError(listing.message))

  // Wait for deleted-file probe before calling the tree "empty" — otherwise
  // deleting the last file flashes the empty state and hides Restore.
  const repoIsEmpty =
    !hasDeleted && !deletedPending && looksUninitialized

  const listingError =
    listing.kind === 'error' && !repoIsEmpty && !hasDeleted && !deletedPending
      ? listing.message
      : null

  const showEmpty =
    !hasDeleted &&
    !deletedPending &&
    (repoIsEmpty ||
      (listing.kind === 'ok' && listing.data.entries.length === 0) ||
      looksUninitialized)

  const emptyMessage = repoIsEmpty ? (
    <div>
      <p className="muted">This repository is empty.</p>
      <p className="muted small">
        Use <strong>Manage Files</strong> to upload a file and create the first
        commit on <code>{branch}</code>.
      </p>
    </div>
  ) : (
    <div>
      <p className="muted">This directory is empty.</p>
      <p className="muted small">Use Manage Files to upload or import.</p>
    </div>
  )

  const showBrowser =
    listing.kind === 'ok' || hasDeleted || deletedHint.kind === 'loading'

  return (
    <main className="page wide repo-data-page">
      <div className="code-toolbar">
        <div className="code-toolbar-left">
          <BranchSwitcher
            branch={branch}
            branches={branchNames}
            disabled={branches.kind !== 'ok'}
            onChange={goBranch}
          />
          {branches.kind === 'ok' && (
            <Link
              className="branch-count-link"
              to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/branches`}
            >
              {branchNames.length} branch{branchNames.length === 1 ? '' : 'es'}
            </Link>
          )}
        </div>
        <div className="btn-row code-toolbar-actions">
          <ManageFilesMenu
            namespace={namespace}
            repo={repo}
            branch={branch}
            path={path}
            onDone={() => {
              listing.reload()
              repoDetail.reload()
              setMutateTick((t) => t + 1)
            }}
          />
          <div className="view-toggle" role="group" aria-label="Directory view">
            <button
              type="button"
              className={`icon-round ${showFilter || nameFilter ? 'is-active' : ''}`}
              aria-pressed={showFilter}
              title="Filter files"
              aria-label="Filter files in this directory"
              onClick={() => setShowFilter((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l2.79 2.79a.75.75 0 1 1-1.06 1.06l-2.79-2.79Z"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`icon-round ${viewMode === 'list' ? 'is-active' : ''}`}
              aria-pressed={viewMode === 'list'}
              title="List view"
              onClick={() => setViewMode('list')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Zm0 4a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`icon-round ${viewMode === 'grid' ? 'is-active' : ''}`}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              onClick={() => setViewMode('grid')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M2.5 2.5h4v4h-4v-4Zm7 0h4v4h-4v-4Zm-7 7h4v4h-4v-4Zm7 0h4v4h-4v-4Z"
                />
              </svg>
            </button>
            <button
              type="button"
              className="icon-round"
              title="Sort entries"
              aria-label="Sort directory entries"
              onClick={() => setSortAsc((v) => !v)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m21 16-4 4-4-4" />
                <path d="M17 20V4" />
                <path d="m3 8 4-4 4 4" />
                <path d="M7 4v16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {(showFilter || nameFilter) && (
        <div className="file-filter file-filter-toolbar">
          <input
            type="search"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Filter files in this directory"
            aria-label="Filter files in this directory"
            autoFocus={showFilter}
          />
        </div>
      )}

      <nav className="path-crumbs hub-path" aria-label="Resource path">
        {crumbs.map((c, i) => (
          <span key={c.to} className="hub-path-part">
            {i > 0 && <span className="repo-header-sep">/</span>}
            {i === crumbs.length - 1 ? (
              <strong>{c.label}</strong>
            ) : (
              <Link to={c.to}>{c.label}</Link>
            )}
          </span>
        ))}
        {path && (
          <Link
            className="muted small hub-path-up"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}${parentPath(path) ? `/${parentPath(path)}` : ''}`}
          >
            Up
          </Link>
        )}
      </nav>

      <StateBlock
        loading={
          (listing.kind === 'loading' || deletedPending) && !hasDeleted
        }
        error={listingError}
        onRetry={() => {
          listing.reload()
          repoDetail.reload()
          setMutateTick((t) => t + 1)
        }}
        empty={showEmpty}
        emptyMessage={emptyMessage}
      >
        {showBrowser && (
          <div className="file-browser">
            {listing.kind === 'ok' && latestCommit && (
              <div className="latest-commit">
                <AuthorAvatar name={latestCommit.author || 'unknown'} />
                <span className="latest-commit-author">
                  {latestCommit.author || 'unknown'}
                </span>
                <Link
                  className="latest-commit-msg"
                  to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits/${encodeURIComponent(latestCommit.id)}`}
                >
                  {latestCommit.message}
                </Link>
                <Link
                  className="latest-commit-hash mono"
                  to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits/${encodeURIComponent(latestCommit.id)}`}
                  title={latestCommit.id}
                >
                  {latestCommit.id.slice(0, 8)}
                </Link>
                <span className="latest-commit-sep muted" aria-hidden>
                  ·
                </span>
                <time
                  dateTime={latestCommit.timestamp}
                  title={new Date(latestCommit.timestamp).toLocaleString()}
                >
                  {formatRelativeTime(latestCommit.timestamp)}
                </time>
                <Link
                  className="latest-commit-count"
                  to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits`}
                >
                  <svg
                    className="latest-commit-history-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden
                  >
                    <path
                      fill="currentColor"
                      d="M8 1.5a6.5 6.5 0 1 0 4.03 11.6.75.75 0 0 0-.94-1.17A5 5 0 1 1 8 3a.75.75 0 0 0 0-1.5Zm.75 3.25v2.69l1.78 1.78a.75.75 0 1 1-1.06 1.06l-2.25-2.25A.75.75 0 0 1 7 7.5v-2.75a.75.75 0 0 1 1.5 0Z"
                    />
                  </svg>
                  {commitCount == null
                    ? '… Commits'
                    : `${commitCount} Commit${commitCount === 1 ? '' : 's'}`}
                </Link>
              </div>
            )}
            {viewMode === 'list' ? (
              <ul className="file-list" aria-label="Directory entries">
                {visibleEntries.map((entry) => {
                  const entryPath = joinPath(path, entry.filename)
                  const href = entry.is_dir
                    ? `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}/${entryPath}`
                    : `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${entryPath}`
                  const commit = entry.latest_commit
                  const dtype = entry.data_type || 'file'
                  return (
                    <li
                      key={entry.hash + entry.filename}
                      className="file-row"
                    >
                      <span className="file-row-name">
                        <FileIcon
                          isDir={entry.is_dir}
                          filename={entry.filename}
                        />
                        <Link to={href} className="file-name-link" title={entry.filename}>
                          {entry.filename}
                        </Link>
                      </span>
                      <span className="file-row-size muted">
                        {entry.is_dir ? '' : formatBytes(entry.size)}
                      </span>
                      <span className="file-row-msg muted" title={commit?.message}>
                        {commit?.message ?? '—'}
                      </span>
                      <span className="file-row-actions">
                        {!entry.is_dir && (
                          <button
                            type="button"
                            className="file-row-icon-btn"
                            title="Download"
                            aria-label={`Download ${entry.filename}`}
                            disabled={busy}
                            onClick={() => {
                              void run(async () => {
                                const blob = await downloadFile(
                                  namespace,
                                  repo,
                                  branch,
                                  entryPath,
                                )
                                triggerDownload(blob, entry.filename)
                              })
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                              <path
                                fill="currentColor"
                                d="M8 1.5a.75.75 0 0 1 .75.75v6.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5ZM2.75 12a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z"
                              />
                            </svg>
                          </button>
                        )}
                        {!entry.is_dir && (
                          <span
                            className={`file-type-badge dtype-chip dtype-${dtype.toLowerCase()}`}
                            title={dtype}
                            aria-label={dtype}
                          >
                            <DataTypeIcon type={dtype} size={12} />
                            <span className="file-type-label">{dtype}</span>
                          </span>
                        )}
                        <details className="row-more">
                          <summary
                            className="file-row-icon-btn"
                            aria-label={`More actions for ${entry.filename}`}
                            title="More"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                              <path
                                fill="currentColor"
                                d="M3 8a1.25 1.25 0 1 1 2.5 0A1.25 1.25 0 0 1 3 8Zm4.75 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0ZM11.25 8A1.25 1.25 0 1 1 14 8a1.25 1.25 0 0 1-2.75 0Z"
                              />
                            </svg>
                          </summary>
                          <div className="row-more-menu">
                            {!entry.is_dir && entry.data_type === 'tabular' && (
                              <Link
                                to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/df/${encodeURIComponent(branch)}/${entryPath}`}
                              >
                                Table
                              </Link>
                            )}
                            {!entry.is_dir && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openPathChange('rename', entryPath)}
                              >
                                Rename
                              </button>
                            )}
                            {!entry.is_dir && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openPathChange('move', entryPath)}
                              >
                                Move
                              </button>
                            )}
                            {!entry.is_dir && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openPathChange('copy', entryPath)}
                              >
                                Copy
                              </button>
                            )}
                            <hr className="menu-sep" />
                            <button
                              type="button"
                              className="danger-text"
                              disabled={busy}
                              onClick={() => onDelete(entryPath, entry.is_dir)}
                            >
                              Delete
                            </button>
                          </div>
                        </details>
                      </span>
                      <span className="file-row-age muted">
                        {commit?.timestamp ? (
                          <time
                            dateTime={commit.timestamp}
                            title={new Date(commit.timestamp).toLocaleString()}
                          >
                            {formatRelativeTime(commit.timestamp)}
                          </time>
                        ) : (
                          '—'
                        )}
                      </span>
                    </li>
                  )
                })}
                {deletedEntries.map((d) => (
                  <li
                    key={`deleted:${d.path}`}
                    className="file-row file-row-deleted"
                    data-testid="file-row-deleted"
                  >
                    <span className="file-row-name">
                      <FileIcon isDir={false} filename={d.filename} />
                      <span className="file-row-name-text">
                        <Link
                          to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(d.sourceRevision)}/${d.path}`}
                          className="file-name-link file-name-deleted"
                          title={`${d.filename} (deleted)`}
                        >
                          {d.filename}
                        </Link>
                        <span className="file-deleted-badge">Deleted</span>
                      </span>
                    </span>
                    <span className="file-row-size muted">
                      {d.size != null ? formatBytes(d.size) : ''}
                    </span>
                    <span className="file-row-msg muted">
                      Removed in this commit
                    </span>
                    <span className="file-row-actions">
                      <button
                        type="button"
                        className="btn ghost small file-restore-btn"
                        disabled={busy}
                        title={`Restore to ${writeBranch}`}
                        onClick={() =>
                          onRestoreDeleted(d.path, d.sourceRevision)
                        }
                      >
                        <RestoreIcon size={13} />
                        Restore
                      </button>
                    </span>
                    <span className="file-row-age muted">—</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="file-grid">
                {visibleEntries.map((entry) => {
                  const entryPath = joinPath(path, entry.filename)
                  const href = entry.is_dir
                    ? `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}/${entryPath}`
                    : `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${entryPath}`
                  return (
                    <li key={entry.hash + entry.filename}>
                      <Link className="file-grid-card" to={href}>
                        <FileIcon
                          isDir={entry.is_dir}
                          filename={entry.filename}
                        />
                        <span className="file-grid-name">{entry.filename}</span>
                        <span className="muted small">
                          {entry.is_dir ? 'Folder' : formatBytes(entry.size)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
                {deletedEntries.map((d) => (
                  <li key={`deleted:${d.path}`}>
                    <div
                      className="file-grid-card file-grid-card-deleted"
                      data-testid="file-grid-deleted"
                    >
                      <FileIcon isDir={false} filename={d.filename} />
                      <span className="file-grid-name file-name-deleted">
                        {d.filename}
                      </span>
                      <span className="file-deleted-badge">Deleted</span>
                      <button
                        type="button"
                        className="btn ghost small file-restore-btn"
                        disabled={busy}
                        onClick={() =>
                          onRestoreDeleted(d.path, d.sourceRevision)
                        }
                      >
                        <RestoreIcon size={13} />
                        Restore
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </StateBlock>

      {readmeName && (
        <section className="panel readme-panel hub-readme">
          <StateBlock
            loading={readme.kind === 'loading'}
            error={readme.kind === 'error' ? readme.message : null}
          >
            {readme.kind === 'ok' && readme.data != null && (
              <Markdown source={readme.data} />
            )}
          </StateBlock>
        </section>
      )}

      {pathChange && (
        <section
          className="panel path-change-panel"
          data-testid={`path-change-${pathChange.mode}`}
        >
          <h2 className="section-label">
            {pathChange.mode === 'rename'
              ? 'Rename file'
              : pathChange.mode === 'copy'
                ? 'Copy file'
                : 'Move file'}
          </h2>
          <p className="muted small path-change-from">
            From <code className="mono">{pathChange.from}</code>
            {pathChange.mode === 'rename' && parentPath(pathChange.from) && (
              <>
                {' '}
                in <code className="mono">{parentPath(pathChange.from)}/</code>
              </>
            )}
          </p>
          <form className="form" onSubmit={onPathChangeSubmit}>
            {pathChange.mode === 'rename' ? (
              <label>
                New name
                <input
                  value={pathChangeTo}
                  onChange={(e) => setPathChangeTo(e.target.value)}
                  required
                  autoFocus
                  spellCheck={false}
                  placeholder={baseName(pathChange.from)}
                />
              </label>
            ) : (
              <label>
                Destination path
                <input
                  value={pathChangeTo}
                  onChange={(e) => setPathChangeTo(e.target.value)}
                  required
                  autoFocus
                  spellCheck={false}
                  placeholder={
                    pathChange.mode === 'copy'
                      ? `folder/${baseName(pathChange.from)}`
                      : 'folder/new-name.ext'
                  }
                />
              </label>
            )}
            <p className="muted small">
              {pathChange.mode === 'rename'
                ? 'Keeps the file in the same folder. Lineage records a rename.'
                : pathChange.mode === 'copy'
                  ? onCommitRef
                    ? `Keeps the same file name in another folder. Reads this commit; writes to branch ${writeBranch}.`
                    : 'Keeps the same file name in another folder. Original stays; lineage records a copy.'
                  : 'Change folder and/or name. Same-folder targets are recorded as rename.'}
            </p>
            <div className="btn-row">
              <button className="btn" type="submit" disabled={busy}>
                {pathChange.mode === 'rename'
                  ? 'Rename'
                  : pathChange.mode === 'copy'
                    ? 'Copy'
                    : 'Move'}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={closePathChange}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {info && <p className="flash flash-success" role="status">{info}</p>}
      {error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
