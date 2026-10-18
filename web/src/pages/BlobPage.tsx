import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { LineageGraph } from '../components/LineageGraph'
import { StateBlock } from '../components/StateBlock'
import {
  DownloadIcon,
  EditIcon,
  GraphIcon,
  HashIcon,
  HistoryIcon,
  MoreIcon,
  PackageIcon,
  RawIcon,
  RefreshIcon,
  RestoreIcon,
  TabularTypeIcon,
  TrashIcon,
} from '../components/icons'
import { useAsync } from '../hooks/useAsync'
import {
  deleteFile,
  downloadFile,
  downloadFileText,
  downloadVersionByHash,
  downloadVersionResource,
  getFileMetadata,
  getVersionFileMetadata,
  listBranches,
  listFileVersions,
  refreshEntryMetadata,
  restoreFile,
  triggerDownload,
  uploadFile,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import {
  lastBranch,
  resolveDefaultBranch,
} from '../lib/lastBranch'
import { fetchLineage, rebuildLineage } from '../lib/lineage'
import { formatBytes } from '../lib/oxen/client'
import { looksLikeCommitId, parentPath } from '../lib/oxen/paths'
import { OxenApiError, type MetadataEntry } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml))/i

type Preview =
  | { kind: 'text'; text: string; entry: MetadataEntry }
  | { kind: 'image'; url: string; entry: MetadataEntry }
  | { kind: 'binary'; entry: MetadataEntry }

type BlobTab = 'preview' | 'metadata' | 'history' | 'lineage'

const TABS: { id: BlobTab; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'history', label: 'History' },
  { id: 'lineage', label: 'Lineage' },
]

function isBlobTab(value: string | null): value is BlobTab {
  return (
    value === 'preview' ||
    value === 'metadata' ||
    value === 'history' ||
    value === 'lineage'
  )
}

export function BlobPage() {
  const { namespace = '', repo = '', branch = 'main', '*': splat } = useParams()
  const path = splat ?? ''
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const moreRef = useRef<HTMLDetailsElement>(null)
  const tabParam = searchParams.get('tab')
  const [tab, setTabState] = useState<BlobTab>(() =>
    isBlobTab(tabParam) ? tabParam : 'preview',
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lineageTick, setLineageTick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [commitMessage, setCommitMessage] = useState('')

  function setTab(next: BlobTab) {
    setTabState(next)
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'preview') params.delete('tab')
        else params.set('tab', next)
        return params
      },
      { replace: true },
    )
  }

  useEffect(() => {
    setEditing(false)
    setDraft('')
    setCommitMessage('')
  }, [namespace, repo, branch, path])

  // Deep-link / graph navigation: keep tab in sync with ?tab=
  useEffect(() => {
    if (isBlobTab(tabParam)) setTabState(tabParam)
    else setTabState('preview')
  }, [tabParam, path])

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const branchNames =
    branches.kind === 'ok'
      ? branches.data.branches.map((b) => b.name)
      : []
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

  const tipPresence = useAsync(async (signal) => {
    try {
      await getFileMetadata(namespace, repo, writeBranch, path, signal)
      return true
    } catch {
      return false
    }
  }, [namespace, repo, writeBranch, path])

  const missingAtTip =
    tipPresence.kind === 'ok' && tipPresence.data === false

  const preview = useAsync(async (signal) => {
    const { entry } = await getFileMetadata(
      namespace,
      repo,
      branch,
      path,
      signal,
    )
    const mime = entry.mime_type || ''
    if (entry.data_type === 'text' || TEXTUAL.test(mime)) {
      const text = await downloadFileText(
        namespace,
        repo,
        branch,
        path,
        signal,
      )
      return { kind: 'text', text, entry } satisfies Preview
    }
    if (mime.startsWith('image/')) {
      const blob = await downloadFile(namespace, repo, branch, path, signal)
      return {
        kind: 'image',
        url: URL.createObjectURL(blob),
        entry,
      } satisfies Preview
    }
    return { kind: 'binary', entry } satisfies Preview
  }, [namespace, repo, branch, path])

  const history = useAsync(
    (signal) =>
      listFileVersions(
        namespace,
        repo,
        // Prefer a real branch for version listing when viewing a commit.
        onCommitRef ? writeBranch : branch,
        path,
        signal,
      ),
    [namespace, repo, branch, writeBranch, onCommitRef, path],
  )

  const lineage = useAsync(
    (signal) =>
      fetchLineage(
        {
          namespace,
          repo,
          path,
          direction: 'both',
          depth: 12,
          limit: 50,
        },
        signal,
      ),
    [namespace, repo, path, lineageTick],
  )

  const versionMeta = useAsync(
    async (signal) => {
      if (preview.kind !== 'ok' || !preview.data.entry.hash) return null
      try {
        return await getVersionFileMetadata(
          namespace,
          repo,
          preview.data.entry.hash,
          signal,
        )
      } catch {
        return null
      }
    },
    [
      namespace,
      repo,
      preview.kind === 'ok' ? preview.data.entry.hash : '',
    ],
  )

  function closeMore() {
    if (moreRef.current) moreRef.current.open = false
  }

  async function onDownload() {
    const blob = await downloadFile(namespace, repo, branch, path)
    triggerDownload(blob, path.split('/').pop() || 'download')
  }

  async function onRebuildLineage() {
    setBusy(true)
    setActionError(null)
    try {
      const res = await rebuildLineage({
        namespace,
        repo,
        branch,
        path,
      })
      setActionInfo(
        res.created
          ? `Derived ${res.created} lineage op(s) from oxen history.`
          : 'Lineage unchanged — each file version already has a single producer.',
      )
      setLineageTick((t) => t + 1)
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Lineage rebuild failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDownloadVersionStore() {
    closeMore()
    try {
      const blob = await downloadVersionResource(
        namespace,
        repo,
        branch,
        path,
      )
      triggerDownload(blob, path.split('/').pop() || 'download')
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Version download failed',
      )
    }
  }

  async function onDownloadByHash() {
    const hash = entry?.hash
    if (!hash) return
    closeMore()
    setBusy(true)
    setActionError(null)
    setActionInfo(null)
    try {
      const blob = await downloadVersionByHash(namespace, repo, hash)
      triggerDownload(blob, path.split('/').pop() || hash.slice(0, 12))
      setActionInfo(`Downloaded ${blob.size} bytes by content hash.`)
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Hash download failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    closeMore()
    if (onCommitRef) {
      setActionError('Delete requires a branch tip. Switch to a branch first.')
      return
    }
    if (
      !(await confirmDelete({
        title: `Delete file ${path}`,
        detail: `“${path}” on branch “${writeBranch}” will be removed in a new commit.`,
        requireTypedConfirm: false,
      })
    )) {
      return
    }
    try {
      await deleteFile(namespace, repo, writeBranch, path, `Delete ${path}`)
      const parent = parentPath(path)
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(writeBranch)}${parent ? `/${parent}` : ''}`,
      )
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed',
      )
    }
  }

  async function onRestore(sourceRevision: string) {
    if (looksLikeCommitId(writeBranch)) {
      setActionError('Select a branch before restoring (current view is a commit).')
      return
    }
    setBusy(true)
    setActionError(null)
    setActionInfo(null)
    try {
      await restoreFile(
        namespace,
        repo,
        writeBranch,
        path,
        sourceRevision,
        `Restore ${path}`,
      )
      setActionInfo(`Restored “${path}” on branch ${writeBranch}.`)
      tipPresence.reload()
      preview.reload()
      history.reload()
      setLineageTick((t) => t + 1)
      setTab('preview')
      if (onCommitRef || branch !== writeBranch) {
        navigate(
          `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(writeBranch)}/${path}`,
        )
      }
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Restore failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onRefreshMetadata() {
    closeMore()
    setBusy(true)
    setActionError(null)
    setActionInfo(null)
    try {
      await refreshEntryMetadata(namespace, repo, branch, path)
      setActionInfo(
        'Derived metadata refreshed (sizes / type counts / text stats). Custom labels are not supported by this endpoint.',
      )
      preview.reload()
      setTab('metadata')
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Metadata refresh failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onOpenRaw() {
    const text =
      preview.kind === 'ok' && preview.data.kind === 'text'
        ? preview.data.text
        : ''
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function startEditing() {
    if (preview.kind !== 'ok' || preview.data.kind !== 'text') return
    setDraft(preview.data.text)
    setCommitMessage(`Update ${path.split('/').pop() || path}`)
    setActionError(null)
    setActionInfo(null)
    setEditing(true)
    setTab('preview')
  }

  function cancelEditing() {
    setEditing(false)
    setDraft('')
    setCommitMessage('')
  }

  async function onSaveEdit() {
    if (preview.kind !== 'ok' || preview.data.kind !== 'text') return
    const original = preview.data.text
    if (draft === original) {
      setActionInfo('No changes to save.')
      setEditing(false)
      return
    }
    const msg = commitMessage.trim() || `Update ${path.split('/').pop() || path}`
    setBusy(true)
    setActionError(null)
    setActionInfo(null)
    try {
      const name = path.split('/').pop() || 'file.txt'
      const mime =
        preview.data.entry.mime_type && preview.data.entry.mime_type !== ''
          ? preview.data.entry.mime_type
          : 'text/plain'
      const file = new File([draft], name, { type: mime })
      await uploadFile(namespace, repo, branch, path, file, msg)
      setEditing(false)
      setActionInfo(`Saved “${name}” on ${branch}.`)
      preview.reload()
      history.reload()
      setLineageTick((t) => t + 1)
    } catch (err) {
      setActionError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Save failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const treeParent = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}${parentPath(path) ? `/${parentPath(path)}` : ''}`
  const entry = preview.kind === 'ok' ? preview.data.entry : null
  const fileName = path.split('/').pop() || path
  const commitsHref = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
  const tableHref = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/df/${encodeURIComponent(branch)}/${path}`
  const isText = preview.kind === 'ok' && preview.data.kind === 'text'
  const dirty =
    editing &&
    preview.kind === 'ok' &&
    preview.data.kind === 'text' &&
    draft !== preview.data.text

  return (
    <main className="page wide">
      <div className="blob-header page-head">
        <div>
          <Breadcrumbs
            items={repoCrumbs(
              namespace,
              repo,
              { label: branch, to: treeParent },
              { label: path },
            )}
          />
          <h1 className="blob-title">{fileName}</h1>
          {entry && (
            <p className="muted small">
              {formatBytes(entry.size)}
              {entry.latest_commit?.timestamp
                ? ` · ${formatRelativeTime(entry.latest_commit.timestamp)}`
                : ''}
            </p>
          )}
        </div>

        <div className="blob-toolbar" role="toolbar" aria-label="File actions">
          <button
            type="button"
            className="blob-tool"
            onClick={() => void onDownload()}
            title="Download"
          >
            <DownloadIcon size={16} />
            <span>Download</span>
          </button>
          {isText && !editing && (
            <button
              type="button"
              className="blob-tool"
              onClick={startEditing}
              title="Edit text"
              disabled={busy}
            >
              <EditIcon size={16} />
              <span>Edit</span>
            </button>
          )}
          {isText && !editing && (
            <button
              type="button"
              className="blob-tool"
              onClick={onOpenRaw}
              title="Open raw text"
            >
              <RawIcon size={16} />
              <span>Raw</span>
            </button>
          )}
          {entry?.data_type === 'tabular' && (
            <Link className="blob-tool" to={tableHref} title="Open as table">
              <TabularTypeIcon size={16} />
              <span>Table</span>
            </Link>
          )}
          {missingAtTip && preview.kind === 'ok' && (
            <button
              type="button"
              className="blob-tool"
              disabled={busy || looksLikeCommitId(writeBranch)}
              title={`Restore this version to ${writeBranch}`}
              onClick={() =>
                void onRestore(
                  entry?.latest_commit?.id || branch,
                )
              }
            >
              <RestoreIcon size={16} />
              <span>Restore to {writeBranch}</span>
            </button>
          )}

          <details className="blob-ops-menu" ref={moreRef}>
            <summary className="blob-tool" title="More actions">
              <MoreIcon size={16} />
              <span>More</span>
            </summary>
            <div className="blob-ops-panel" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => void onRefreshMetadata()}
              >
                <RefreshIcon size={15} />
                Refresh metadata
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void onDownloadVersionStore()}
              >
                <PackageIcon size={15} />
                Download (version store)
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy || !entry?.hash}
                onClick={() => void onDownloadByHash()}
                title="QUERY /versions with content hash"
              >
                <HashIcon size={15} />
                Download by hash
              </button>
              <Link
                role="menuitem"
                to={commitsHref}
                onClick={closeMore}
              >
                <HistoryIcon size={15} />
                Commit history
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMore()
                  setTab('lineage')
                }}
              >
                <GraphIcon size={15} />
                View lineage
              </button>
              <hr className="blob-ops-sep" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => void onDelete()}
              >
                <TrashIcon size={15} />
                Delete file
              </button>
            </div>
          </details>
        </div>
      </div>

      {actionInfo && <p className="ok">{actionInfo}</p>}
      {actionError && <p className="error">{actionError}</p>}

      <div className="tab-bar blob-tabs" role="tablist" aria-label="File views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`blob-tab-${t.id}`}
            className={tab === t.id ? 'active' : ''}
            aria-selected={tab === t.id}
            aria-controls={`blob-panel-${t.id}`}
            data-testid={`blob-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'preview' && (
        <section
          className="panel blob-preview-panel"
          role="tabpanel"
          id="blob-panel-preview"
          aria-labelledby="blob-tab-preview"
        >
          {preview.kind === 'error' && missingAtTip && (
            <div className="blob-missing" data-testid="blob-missing">
              <p>
                <code className="mono">{path}</code> is not present on branch{' '}
                <code className="mono">{writeBranch}</code>.
              </p>
              <p className="muted small">
                It may have been deleted. Restore a prior version from History,
                or pick a version below.
              </p>
              {history.kind === 'ok' && history.data.versions[0] && (
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      void onRestore(history.data.versions[0]!.commit.id)
                    }
                  >
                    <RestoreIcon size={14} />
                    Restore latest version
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setTab('history')}
                  >
                    View history
                  </button>
                </div>
              )}
              {history.kind === 'ok' && history.data.versions.length === 0 && (
                <p className="muted small">No prior versions found for this path.</p>
              )}
            </div>
          )}
          <StateBlock
            loading={preview.kind === 'loading' && !editing}
            error={
              preview.kind === 'error' && !missingAtTip
                ? preview.message
                : null
            }
          >
            {preview.kind === 'ok' &&
              preview.data.kind === 'text' &&
              editing && (
                <div className="blob-editor" data-testid="blob-editor">
                  <div className="blob-editor-toolbar">
                    <label className="blob-editor-message">
                      <span className="muted small">Commit message</span>
                      <input
                        type="text"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        disabled={busy}
                        placeholder={`Update ${fileName}`}
                      />
                    </label>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy}
                        onClick={cancelEditing}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !dirty}
                        onClick={() => void onSaveEdit()}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="blob-editor-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                    spellCheck={false}
                    aria-label={`Edit ${fileName}`}
                    rows={Math.min(
                      40,
                      Math.max(12, draft.split('\n').length + 2),
                    )}
                  />
                  <p className="muted small blob-editor-hint">
                    Saves a new commit on <code className="mono">{branch}</code>
                    {dirty ? ' · unsaved changes' : ' · no changes yet'}.
                  </p>
                </div>
              )}
            {preview.kind === 'ok' &&
              preview.data.kind === 'text' &&
              !editing && (
                <div className="blob-code">
                  <table className="blob-code-table">
                    <tbody>
                      {preview.data.text.split('\n').map((line, i) => (
                        <tr key={i}>
                          <td className="blob-line-num" data-line-number={i + 1}>
                            {i + 1}
                          </td>
                          <td className="blob-line-code">
                            <pre>{line.length ? line : ' '}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            {preview.kind === 'ok' && preview.data.kind === 'image' && (
              <img className="img-preview" src={preview.data.url} alt={path} />
            )}
            {preview.kind === 'ok' && preview.data.kind === 'binary' && (
              <p className="muted">
                Binary file — use Download to save a copy.
              </p>
            )}
          </StateBlock>
        </section>
      )}

      {tab === 'metadata' && (
        <section
          className="panel"
          role="tabpanel"
          id="blob-panel-metadata"
          aria-labelledby="blob-tab-metadata"
        >
          <StateBlock
            loading={preview.kind === 'loading'}
            error={preview.kind === 'error' ? preview.message : null}
            empty={!entry}
            emptyMessage="No metadata available for this file."
          >
            {entry && (
              <dl className="kv blob-meta-kv">
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(entry.size)}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>
                    {entry.data_type} · {entry.mime_type}
                  </dd>
                </div>
                <div>
                  <dt>Hash</dt>
                  <dd className="mono">{entry.hash}</dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd className="mono">
                    {entry.latest_commit?.id.slice(0, 12) ?? '—'}
                    {entry.latest_commit
                      ? ` — ${entry.latest_commit.message}`
                      : ''}
                  </dd>
                </div>
                {entry.metadata != null && (
                  <div>
                    <dt>Derived meta</dt>
                    <dd>
                      <pre className="code-preview" style={{ margin: 0 }}>
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {versionMeta.kind === 'ok' && versionMeta.data && (
              <dl className="kv blob-meta-kv" style={{ marginTop: '1rem' }}>
                <div>
                  <dt>Version store</dt>
                  <dd className="mono">{versionMeta.data.version.hash}</dd>
                </div>
                <div>
                  <dt>Stored size</dt>
                  <dd>{formatBytes(versionMeta.data.version.size)}</dd>
                </div>
              </dl>
            )}
          </StateBlock>
        </section>
      )}

      {tab === 'history' && (
        <section
          className="panel"
          role="tabpanel"
          id="blob-panel-history"
          aria-labelledby="blob-tab-history"
        >
          <div className="section-head">
            <h2 className="section-label">
              Versions from{' '}
              <code className="mono">
                {looksLikeCommitId(branch) ? branch.slice(0, 8) : branch}
              </code>
            </h2>
            <Link className="btn ghost small" to={commitsHref}>
              <HistoryIcon size={14} />
              Full commit log
            </Link>
          </div>
          <StateBlock
            loading={history.kind === 'loading'}
            error={history.kind === 'error' ? history.message : null}
            empty={
              history.kind === 'ok' && history.data.versions.length === 0
            }
            emptyMessage="No versions recorded for this path."
          >
            {history.kind === 'ok' && (
              <ul className="commit-list">
                {history.data.versions.map((v) => (
                  <li
                    key={v.commit.id + v.resource.version}
                    className="commit-list-row"
                  >
                    <Link
                      to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(v.commit.id)}/${path}`}
                    >
                      <span className="commit-msg">{v.commit.message}</span>
                      <span className="commit-meta">
                        <span className="mono">
                          {v.commit.id.slice(0, 8)}
                        </span>
                        {' · '}
                        {v.commit.author}
                        {' · '}
                        <time
                          dateTime={v.commit.timestamp}
                          title={new Date(v.commit.timestamp).toLocaleString()}
                        >
                          {formatRelativeTime(v.commit.timestamp)}
                        </time>
                      </span>
                    </Link>
                    {missingAtTip && (
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={busy || looksLikeCommitId(writeBranch)}
                        title={`Restore this version to ${writeBranch}`}
                        onClick={() => void onRestore(v.commit.id)}
                      >
                        <RestoreIcon size={13} />
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </StateBlock>
        </section>
      )}

      {tab === 'lineage' && (
        <section
          className="panel"
          role="tabpanel"
          id="blob-panel-lineage"
          aria-labelledby="blob-tab-lineage"
          data-testid="lineage-panel"
        >
          <div className="section-head">
            <h2 className="section-label">
              <GraphIcon size={16} className="section-label-icon" />
              Lineage
            </h2>
            <button
              type="button"
              className="btn ghost small"
              disabled={busy}
              onClick={() => void onRebuildLineage()}
              title="Derive upload/edit chain from oxen path history"
            >
              <RefreshIcon size={14} />
              Rebuild from history
            </button>
          </div>
          <StateBlock
            loading={lineage.kind === 'loading'}
            error={lineage.kind === 'error' ? lineage.message : null}
            empty={
              lineage.kind === 'ok' && lineage.data.operations.length === 0
            }
            emptyMessage="No lineage ops for this path yet. Upload or edit via Boxen, or rebuild from history."
          >
            {lineage.kind === 'ok' && (
              <LineageGraph
                operations={lineage.data.operations}
                namespace={namespace}
                repo={repo}
                branch={branch}
                focusPath={path}
              />
            )}
          </StateBlock>
        </section>
      )}
    </main>
  )
}
