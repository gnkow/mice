import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  getDataFrameSlice,
  indexDataFrame,
  listWorkspaces,
  setWorkspaceColumnSchemaMetadata,
  setWorkspaceDataFrameSchemaMetadata,
} from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw || '{}')
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new Error('Metadata must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function DataFramePage() {
  const { namespace = '', repo = '', branch = 'main', '*': splat } = useParams()
  const path = splat ?? ''
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [workspaceId, setWorkspaceId] = useState('')
  const [schemaMeta, setSchemaMeta] = useState('{\n  "description": ""\n}')
  const [columnName, setColumnName] = useState('')
  const [columnMeta, setColumnMeta] = useState('{\n  "description": ""\n}')

  const slice = useAsync(
    (signal) =>
      getDataFrameSlice(
        namespace,
        repo,
        branch,
        path,
        { page, pageSize },
        signal,
      ),
    [namespace, repo, branch, path, page, pageSize],
  )

  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, repo, signal),
    [namespace, repo],
  )

  async function onIndex() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await indexDataFrame(namespace, repo, branch, path)
      setInfo('Indexing started or refreshed for this data frame.')
      slice.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Index failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function runMeta(action: () => Promise<void>, ok: string) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
      setInfo(ok)
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Metadata update failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onSchemaMeta(e: FormEvent) {
    e.preventDefault()
    if (!workspaceId) {
      setError('Select a workspace to stage schema metadata')
      return
    }
    void runMeta(async () => {
      await setWorkspaceDataFrameSchemaMetadata(
        namespace,
        repo,
        workspaceId,
        path,
        parseJsonObject(schemaMeta),
      )
    }, 'Schema metadata staged in workspace. Commit from the workspace page.')
  }

  function onColumnMeta(e: FormEvent) {
    e.preventDefault()
    if (!workspaceId) {
      setError('Select a workspace to stage column metadata')
      return
    }
    if (!columnName.trim()) {
      setError('Column name is required')
      return
    }
    void runMeta(async () => {
      await setWorkspaceColumnSchemaMetadata(
        namespace,
        repo,
        workspaceId,
        path,
        columnName.trim(),
        parseJsonObject(columnMeta),
      )
    }, `Column metadata for “${columnName.trim()}” staged. Commit from the workspace page.`)
  }

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const df = slice.kind === 'ok' ? slice.data.data_frame : null
  const fields = df?.view.schema.fields ?? []
  const rows = df?.view.data ?? []
  const pagination = df?.view.pagination

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <Breadcrumbs
            items={repoCrumbs(
              namespace,
              repo,
              {
                label: path,
                to: `${base}/tree/${encodeURIComponent(branch)}/${path}`,
              },
              { label: 'Data frame' },
            )}
          />
          <h1>Data frame</h1>
          <p className="lede mono">
            {branch}/{path}
          </p>
        </div>
        <div className="btn-row">
          <Link
            className="btn ghost"
            to={`${base}/df-compare?path=${encodeURIComponent(path)}&base=${encodeURIComponent(branch)}&head=${encodeURIComponent(branch)}`}
          >
            Compare…
          </Link>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={onIndex}
          >
            Index for query
          </button>
          <Link
            className="btn ghost"
            to={`${base}/blob/${encodeURIComponent(branch)}/${path}`}
          >
            Raw file
          </Link>
        </div>
      </div>

      <StateBlock
        loading={slice.kind === 'loading'}
        error={slice.kind === 'error' ? slice.message : null}
      >
        {df && (
          <>
            <dl className="kv panel">
              <div>
                <dt>Rows</dt>
                <dd>
                  {df.source.size.height} × {df.source.size.width} cols
                </dd>
              </div>
              <div>
                <dt>Page</dt>
                <dd>
                  {pagination?.page_number} / {pagination?.total_pages} (
                  {pagination?.total_entries} entries)
                </dd>
              </div>
            </dl>

            <div className="table-scroll panel">
              <table className="file-table df-table">
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <th key={f.name}>
                        {f.name}
                        <span className="muted"> · {f.dtype}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {fields.map((f) => (
                        <td key={f.name}>
                          {row[f.name] == null
                            ? '—'
                            : String(row[f.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && pagination.total_pages > 1 && (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={page >= pagination.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </StateBlock>

      <details className="panel">
        <summary className="section-label" style={{ cursor: 'pointer' }}>
          Advanced · Schema metadata (workspace)
        </summary>
        <p className="muted">
          Stages metadata into a workspace; commit from the{' '}
          <Link to={`${base}/workspaces`}>workspaces</Link> page.
        </p>
        <form className="form" onSubmit={onSchemaMeta}>
          <label>
            Workspace
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              required
            >
              <option value="">Select workspace…</option>
              {workspaces.kind === 'ok' &&
                workspaces.data.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name || w.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Schema metadata (JSON object)
            <textarea
              rows={4}
              value={schemaMeta}
              onChange={(e) => setSchemaMeta(e.target.value)}
              className="mono"
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Stage schema metadata
          </button>
        </form>
        <form className="form" onSubmit={onColumnMeta} style={{ marginTop: '1.25rem' }}>
          <label>
            Column
            <select
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
            >
              <option value="">Select column…</option>
              {fields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Column metadata (JSON object)
            <textarea
              rows={4}
              value={columnMeta}
              onChange={(e) => setColumnMeta(e.target.value)}
              className="mono"
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Stage column metadata
          </button>
        </form>
      </details>

      {info && <p className="flash flash-success" role="status">{info}</p>}
      {error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
