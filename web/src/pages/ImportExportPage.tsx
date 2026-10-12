import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { useAsync } from '../hooks/useAsync'
import {
  downloadVersionsTarball,
  exportZip,
  importFromUrl,
  listBranches,
  triggerDownload,
  uploadZipArchive,
} from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

export function ImportExportPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params] = useSearchParams()
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [branch, setBranch] = useState(params.get('branch') || 'main')
  const [exportPath, setExportPath] = useState(params.get('path') || '')
  const [importPath, setImportPath] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [auth, setAuth] = useState('')
  const [zipDir, setZipDir] = useState('')
  const [hashList, setHashList] = useState('')
  const [editMessage, setEditMessage] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
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

  function commitMsg(fallback: string) {
    return message.trim() || fallback
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
        commitMsg('Import from URL'),
        {
          filename: filename.trim() || undefined,
          auth: auth.trim() || undefined,
        },
      )
      setInfo(`Imported → commit ${res.commit.id.slice(0, 8)}`)
    })
  }

  function onZipUpload(e: FormEvent<HTMLFormElement>) {
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
        commitMsg(`Unpack ${file.name}`),
      )
      setInfo(`Zip unpacked → commit ${res.commit.id.slice(0, 8)}`)
      form.reset()
    })
  }

  function onHashDownload(e: FormEvent) {
    e.preventDefault()
    const hashes = hashList
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean)
    void run(async () => {
      const blob = await downloadVersionsTarball(namespace, repo, hashes)
      triggerDownload(blob, `${repo}-versions.tgz`)
      setInfo(`Downloaded tarball for ${hashes.length} hash(es).`)
    })
  }

  const messageField = editMessage ? (
    <label>
      Commit message
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Auto-generated if empty"
      />
    </label>
  ) : (
    <p className="muted small">
      Commit message will be auto-generated.{' '}
      <button
        type="button"
        className="linkish"
        onClick={() => setEditMessage(true)}
      >
        Edit message
      </button>
    </p>
  )

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Breadcrumbs
            items={repoCrumbs(namespace, repo, { label: 'Import / Export' })}
          />
          <h1>Import / Export</h1>
          <p className="lede">
            Export a zip, import by URL or zip archive. Everyday single-file
            upload stays on Files.
          </p>
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`${base}/tree/${encodeURIComponent(branch)}?manage=upload`}
          >
            Upload
          </Link>
          <label className="branch-pick">
            Branch
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.kind === 'ok' ? (
                branches.data.branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))
              ) : (
                <option value={branch}>{branch}</option>
              )}
            </select>
          </label>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === 'export' ? 'active' : ''}
          aria-selected={tab === 'export'}
          onClick={() => setTab('export')}
        >
          Export
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'import' ? 'active' : ''}
          aria-selected={tab === 'import'}
          onClick={() => setTab('import')}
        >
          Import
        </button>
      </div>

      {tab === 'export' && (
        <>
          <section className="panel">
            <h2 className="section-label">Export zip</h2>
            <form className="form" onSubmit={onExport}>
              <label>
                Path (empty = whole branch)
                <input
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  placeholder="data"
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Download zip
              </button>
            </form>
          </section>

          <details className="panel">
            <summary className="section-label" style={{ cursor: 'pointer' }}>
              Advanced · Download by content hash
            </summary>
            <p className="muted">
              Uses live <code>QUERY /versions</code> (gzip line-delimited
              hashes).
            </p>
            <form className="form" onSubmit={onHashDownload}>
              <label>
                Hashes (one per line)
                <textarea
                  rows={4}
                  value={hashList}
                  onChange={(e) => setHashList(e.target.value)}
                  placeholder="c0786d904914f6ea39ea8e7881dd751d"
                  className="mono"
                  required
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Download .tgz
              </button>
            </form>
          </details>
        </>
      )}

      {tab === 'import' && (
        <>
          <section className="panel">
            <h2 className="section-label">Import from URL</h2>
            <form className="form" onSubmit={onImportUrl}>
              <label>
                Download URL
                <input
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
              <label>
                Destination path
                <input
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  placeholder="imports/file.csv"
                  required
                />
              </label>
              <details>
                <summary className="muted small" style={{ cursor: 'pointer' }}>
                  Optional filename / auth
                </summary>
                <label>
                  Filename override
                  <input
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Auth header
                  <input
                    value={auth}
                    onChange={(e) => setAuth(e.target.value)}
                    placeholder="Bearer … (optional)"
                  />
                </label>
              </details>
              {messageField}
              <button className="btn" type="submit" disabled={busy}>
                Import URL
              </button>
            </form>
          </section>

          <section className="panel">
            <h2 className="section-label">Upload zip archive</h2>
            <form className="form" onSubmit={onZipUpload}>
              <label>
                Destination directory
                <input
                  value={zipDir}
                  onChange={(e) => setZipDir(e.target.value)}
                  placeholder="empty = branch root"
                />
              </label>
              <label>
                Zip file
                <input
                  name="file"
                  type="file"
                  accept=".zip,application/zip"
                  required
                />
              </label>
              {messageField}
              <button className="btn" type="submit" disabled={busy}>
                Upload & unpack
              </button>
            </form>
          </section>
        </>
      )}

      {info && <p className="ok">{info}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
