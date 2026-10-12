import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  deleteFile,
  downloadFile,
  downloadFileText,
  downloadVersionByHash,
  downloadVersionResource,
  getFileMetadata,
  getVersionFileMetadata,
  listFileVersions,
  refreshEntryMetadata,
  triggerDownload,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { formatBytes } from '../lib/oxen/client'
import { parentPath } from '../lib/oxen/paths'
import { OxenApiError, type MetadataEntry } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml))/i

type Preview =
  | { kind: 'text'; text: string; entry: MetadataEntry }
  | { kind: 'image'; url: string; entry: MetadataEntry }
  | { kind: 'binary'; entry: MetadataEntry }

export function BlobPage() {
  const { namespace = '', repo = '', branch = 'main', '*': splat } = useParams()
  const path = splat ?? ''
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    (signal) => listFileVersions(namespace, repo, branch, path, signal),
    [namespace, repo, branch, path],
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

  async function onDownload() {
    const blob = await downloadFile(namespace, repo, branch, path)
    triggerDownload(blob, path.split('/').pop() || 'download')
  }

  async function onDownloadVersionStore() {
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
    if (
      !(await confirmDelete({
        title: `Delete file ${path}`,
        detail: `“${path}” on branch “${branch}” will be removed in a new commit.`,
        requireTypedConfirm: false,
      })
    )) {
      return
    }
    try {
      await deleteFile(namespace, repo, branch, path, `Delete ${path}`)
      const parent = parentPath(path)
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}${parent ? `/${parent}` : ''}`,
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

  async function onRefreshMetadata() {
    setBusy(true)
    setActionError(null)
    setActionInfo(null)
    try {
      await refreshEntryMetadata(namespace, repo, branch, path)
      setActionInfo(
        'Derived metadata refreshed (sizes / type counts / text stats). Custom labels are not supported by this endpoint.',
      )
      preview.reload()
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

  const treeParent = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(branch)}${parentPath(path) ? `/${parentPath(path)}` : ''}`
  const entry = preview.kind === 'ok' ? preview.data.entry : null

  const fileName = path.split('/').pop() || path

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
        <div className="btn-row blob-actions">
          {entry?.data_type === 'tabular' && (
            <Link
              className="btn"
              to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/df/${encodeURIComponent(branch)}/${path}`}
            >
              Open as table
            </Link>
          )}
          <Link
            className="btn ghost"
            to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`}
          >
            History
          </Link>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void onRefreshMetadata()}
          >
            Refresh metadata
          </button>
          <button type="button" className="btn ghost" onClick={onDownload}>
            Download
          </button>
          {preview.kind === 'ok' && preview.data.kind === 'text' && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const text =
                  preview.kind === 'ok' && preview.data.kind === 'text'
                    ? preview.data.text
                    : ''
                const blob = new Blob([text], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                window.open(url, '_blank', 'noopener,noreferrer')
                window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
              }}
            >
              Raw
            </button>
          )}
          <details className="more-actions">
            <summary className="btn ghost">Advanced</summary>
            <div className="more-actions-body">
              <button
                type="button"
                className="btn ghost"
                onClick={() => void onDownloadVersionStore()}
              >
                Download (version store)
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy || !entry?.hash}
                onClick={() => void onDownloadByHash()}
                title="QUERY /versions with content hash (GET by hash alone 404s)"
              >
                Download by hash
              </button>
            </div>
          </details>
          <button
            type="button"
            className="btn danger"
            onClick={() => void onDelete()}
          >
            Delete
          </button>
        </div>
      </div>

      {entry && (
        <dl className="kv panel">
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
        <dl className="kv panel">
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

      <section className="panel blob-preview-panel">
        <h2 className="section-label">Preview</h2>
        <StateBlock
          loading={preview.kind === 'loading'}
          error={preview.kind === 'error' ? preview.message : null}
        >
          {preview.kind === 'ok' && preview.data.kind === 'text' && (
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

      <section className="panel">
        <h2 className="section-label">History on {branch}</h2>
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
                <li key={v.commit.id + v.resource.version}>
                  <Link
                    to={`/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(v.resource.version)}/${path}`}
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
                </li>
              ))}
            </ul>
          )}
        </StateBlock>
      </section>

      {actionInfo && <p className="ok">{actionInfo}</p>}
      {actionError && <p className="error">{actionError}</p>}
    </main>
  )
}
