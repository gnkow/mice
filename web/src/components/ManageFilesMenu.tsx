import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import {
  createFolder,
  exportZip,
  importFromUrl,
  listWorkspaces,
  triggerDownload,
  uploadFile,
  uploadLargeFile,
  UPLOAD_LARGE_THRESHOLD,
  uploadZipArchive,
  type LargeUploadProgress,
} from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { joinPath } from '../lib/oxen/paths'
import { OxenApiError } from '../lib/oxen/types'
import { Modal } from './Modal'

type ModalKind = 'upload' | 'import' | 'export' | 'folder' | null

type Props = {
  namespace: string
  repo: string
  branch: string
  path: string
  onDone?: () => void
}

export function ManageFilesMenu({
  namespace,
  repo,
  branch,
  path,
  onDone,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const pendingDest = useRef<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [modal, setModal] = useState<ModalKind>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Upload (size-aware)
  const [uploadMessage, setUploadMessage] = useState('')
  const [dstDir, setDstDir] = useState(path)
  const [workspaceId, setWorkspaceId] = useState('')
  const [progress, setProgress] = useState<LargeUploadProgress | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)

  // Create folder
  const [folderName, setFolderName] = useState('')
  const [folderMessage, setFolderMessage] = useState('')

  // Import
  const [importMode, setImportMode] = useState<'url' | 'zip'>('url')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [importPath, setImportPath] = useState('')
  const [zipDir, setZipDir] = useState(path)
  const [importMessage, setImportMessage] = useState('')

  // Export
  const [exportPath, setExportPath] = useState(path)

  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, repo, signal),
    [namespace, repo],
  )

  useEffect(() => {
    const manage = searchParams.get('manage')
    if (
      manage !== 'upload' &&
      manage !== 'import' &&
      manage !== 'export' &&
      manage !== 'folder'
    ) {
      return
    }
    pendingDest.current = searchParams.get('path')
    setModal(manage)
    const next = new URLSearchParams(searchParams)
    next.delete('manage')
    next.delete('path')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!modal) return
    const dest = pendingDest.current ?? path
    pendingDest.current = null
    setError(null)
    setInfo(null)
    setProgress(null)
    setCurrentFile(null)
    setExportPath(dest)
    setZipDir(dest)
    setDstDir(dest)
    setFolderName('')
    if (detailsRef.current) detailsRef.current.open = false
  }, [modal, path])

  function open(kind: ModalKind) {
    setModal(kind)
  }

  function close() {
    if (busy) return
    setModal(null)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
      onDone?.()
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

  function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('file') as HTMLInputElement
    const files = input.files ? Array.from(input.files) : []
    if (files.length === 0) return
    const destRoot = dstDir.trim() || path
    void run(async () => {
      const results: string[] = []
      for (const file of files) {
        setCurrentFile(file.name)
        if (file.size >= UPLOAD_LARGE_THRESHOLD) {
          const result = await uploadLargeFile(namespace, repo, file, {
            dstDir: destRoot,
            workspaceId: workspaceId || undefined,
            onProgress: setProgress,
          })
          results.push(
            workspaceId
              ? `${file.name} (chunked, ${formatBytes(file.size)}) staged into workspace → ${result.versionId.slice(0, 12)}…`
              : `${file.name} (chunked, ${formatBytes(file.size)}, ${result.numChunks} chunks) → ${result.versionId.slice(0, 12)}…`,
          )
        } else {
          setProgress(null)
          const dest = joinPath(destRoot, file.name)
          await uploadFile(
            namespace,
            repo,
            branch,
            dest,
            file,
            uploadMessage.trim() || `Add ${file.name}`,
          )
          results.push(`${file.name} (${formatBytes(file.size)})`)
        }
      }
      setCurrentFile(null)
      setProgress(null)
      setInfo(`Uploaded ${results.length} file(s):\n${results.join('\n')}`)
      form.reset()
      setModal(null)
    })
  }

  function onCreateFolder(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await createFolder(
        namespace,
        repo,
        branch,
        path,
        folderName,
        folderMessage.trim() || undefined,
      )
      setInfo(`Created folder ${folderName.trim()}`)
      setModal(null)
    })
  }

  function onImportUrl(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const dest = importPath.trim()
      if (!dest) throw new Error('Destination path is required')
      const res = await importFromUrl(
        namespace,
        repo,
        branch,
        dest,
        downloadUrl.trim(),
        importMessage.trim() || 'Import from URL',
      )
      setInfo(`Imported → commit ${res.commit.id.slice(0, 8)}`)
      setModal(null)
    })
  }

  function onImportZip(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    void run(async () => {
      const res = await uploadZipArchive(
        namespace,
        repo,
        branch,
        zipDir.trim(),
        file,
        importMessage.trim() || `Unpack ${file.name}`,
      )
      setInfo(`Zip unpacked → commit ${res.commit.id.slice(0, 8)}`)
      form.reset()
      setModal(null)
    })
  }

  function onExport(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const blob = await exportZip(namespace, repo, branch, exportPath.trim())
      const name = exportPath.trim()
        ? `${repo}-${exportPath.trim().replace(/\//g, '-')}.zip`
        : `${repo}-${branch}.zip`
      triggerDownload(blob, name)
      setInfo(`Downloaded ${name}`)
      setModal(null)
    })
  }

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const pct =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0

  return (
    <>
      <details className="manage-files" ref={detailsRef}>
        <summary className="btn ghost">Manage Files</summary>
        <div className="manage-files-menu">
          <button type="button" onClick={() => open('upload')}>
            Upload
          </button>
          <button type="button" onClick={() => open('folder')}>
            Create folder
          </button>
          <button type="button" onClick={() => open('import')}>
            Import
          </button>
          <button type="button" onClick={() => open('export')}>
            Export
          </button>
        </div>
      </details>

      {modal === 'upload' && (
        <Modal title="Upload" onClose={close} wide>
          <p className="muted small">
            Files under {formatBytes(UPLOAD_LARGE_THRESHOLD)} use a direct
            commit upload; larger files use the chunked upload API
            automatically.
          </p>
          <form className="form" onSubmit={onUpload}>
            <label>
              File(s)
              <input name="file" type="file" multiple required disabled={busy} />
            </label>
            <label>
              Destination directory
              <input
                value={dstDir}
                onChange={(e) => setDstDir(e.target.value)}
                placeholder={path || '/'}
                disabled={busy}
              />
            </label>
            <label>
              Commit message
              <input
                value={uploadMessage}
                onChange={(e) => setUploadMessage(e.target.value)}
                placeholder="Add {filename}"
                disabled={busy}
              />
            </label>
            <label>
              Stage into workspace
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                disabled={busy}
              >
                <option value="">— commit / store only —</option>
                {workspaces.kind === 'ok' &&
                  workspaces.data.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name || w.id.slice(0, 8)} · {w.commit.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
            {workspaces.kind === 'ok' &&
              workspaces.data.workspaces.length === 0 && (
                <p className="muted small">
                  No workspaces yet.{' '}
                  <Link to={`${base}/workspaces`} onClick={close}>
                    Create one
                  </Link>{' '}
                  to stage large uploads without committing.
                </p>
              )}
            {busy && currentFile && (
              <p className="muted small">
                Uploading <strong>{currentFile}</strong>
                {progress ? ` · ${progress.phase}` : ''}
              </p>
            )}
            {progress && (
              <div className="muted small">
                {progress.phase === 'chunks' && (
                  <p>
                    Chunk {progress.chunksDone}/{progress.chunksTotal}
                  </p>
                )}
                <p>
                  {formatBytes(progress.bytesSent)} /{' '}
                  {formatBytes(progress.totalBytes)} ({pct}%)
                </p>
                <div
                  className="upload-bar"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {modal === 'folder' && (
        <Modal title="Create folder" onClose={close}>
          <p className="muted small">
            Creates <code>{path ? `${path}/` : ''}…/.oxenkeep</code> on branch{' '}
            <code>{branch}</code>.
          </p>
          <form className="form" onSubmit={onCreateFolder}>
            <label>
              Folder name
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="data"
                required
                disabled={busy}
                autoFocus
              />
            </label>
            <label>
              Commit message
              <input
                value={folderMessage}
                onChange={(e) => setFolderMessage(e.target.value)}
                placeholder="Create folder …"
                disabled={busy}
              />
            </label>
            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {modal === 'import' && (
        <Modal title="Import" onClose={close} wide>
          <div className="tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              className={importMode === 'url' ? 'active' : ''}
              aria-selected={importMode === 'url'}
              onClick={() => setImportMode('url')}
            >
              From URL
            </button>
            <button
              type="button"
              role="tab"
              className={importMode === 'zip' ? 'active' : ''}
              aria-selected={importMode === 'zip'}
              onClick={() => setImportMode('zip')}
            >
              Zip archive
            </button>
          </div>
          {importMode === 'url' ? (
            <form className="form" onSubmit={onImportUrl}>
              <label>
                Download URL
                <input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://…"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Destination path
                <input
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  placeholder="imports/file.csv"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Commit message
                <input
                  value={importMessage}
                  onChange={(e) => setImportMessage(e.target.value)}
                  placeholder="Import from URL"
                  disabled={busy}
                />
              </label>
              <div className="modal-actions btn-row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Importing…' : 'Import'}
                </button>
              </div>
            </form>
          ) : (
            <form className="form" onSubmit={onImportZip}>
              <label>
                Destination directory
                <input
                  value={zipDir}
                  onChange={(e) => setZipDir(e.target.value)}
                  placeholder="empty = branch root"
                  disabled={busy}
                />
              </label>
              <label>
                Zip file
                <input
                  name="file"
                  type="file"
                  accept=".zip,application/zip"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Commit message
                <input
                  value={importMessage}
                  onChange={(e) => setImportMessage(e.target.value)}
                  placeholder="Unpack archive"
                  disabled={busy}
                />
              </label>
              <div className="modal-actions btn-row">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Unpacking…' : 'Upload & unpack'}
                </button>
              </div>
            </form>
          )}
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {modal === 'export' && (
        <Modal title="Export" onClose={close}>
          <p className="muted small">
            Download a zip of the current branch (or a subdirectory).
          </p>
          <form className="form" onSubmit={onExport}>
            <label>
              Path (empty = whole branch)
              <input
                value={exportPath}
                onChange={(e) => setExportPath(e.target.value)}
                placeholder={path || 'data'}
                disabled={busy}
              />
            </label>
            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Exporting…' : 'Download zip'}
              </button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {!modal && info && <p className="flash flash-success manage-files-toast">{info}</p>}
      {!modal && error && <p className="error manage-files-toast">{error}</p>}
    </>
  )
}
