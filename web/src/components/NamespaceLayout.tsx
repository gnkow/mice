import { FolderGit2 as ActionFolderGit2 } from 'lucide-react'
import { useMemo } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { EntityIdInline } from './EntityId'
import { FavoriteStar } from './FavoriteStar'
import { StateBlock } from './StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchNamespaceAuthz, listAuthzNamespaces } from '../lib/authzApi'
import { getNamespace } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

function isNotFound(err: unknown): boolean {
  if (!(err instanceof OxenApiError)) return false
  if (err.status === 404) return true
  const msg = err.message.toLowerCase()
  return (
    msg.includes('resource_not_found') ||
    msg.includes('not found') ||
    msg.includes('does not exist')
  )
}

async function loadNamespaceChrome(namespace: string, signal: AbortSignal) {
  const [authz, summaries, detail] = await Promise.all([
    fetchNamespaceAuthz(namespace, signal).catch(() => null),
    listAuthzNamespaces(signal).catch(() => null),
    getNamespace(namespace, signal).catch((err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    }),
  ])
  if (!detail && !authz) throw new Error('Namespace not found')
  const summary = summaries?.namespaces.find((n) => n.name === namespace) ?? null
  const description =
    (authz?.description ?? summary?.description ?? '').trim() || null
  return {
    authz,
    summary,
    description,
    storageGb: detail?.namespace.storage_usage_gb ?? 0,
    onOxen: Boolean(detail),
  }
}

  /** Shared chrome + tabs for `/n/:namespace/*` (repositories, settings). */
  export function NamespaceLayout() {
  const { namespace = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}`
  const state = useAsync((signal) => loadNamespaceChrome(namespace, signal), [namespace])
  const outletContext = useMemo(
    () => ({ reloadChrome: () => state.reload() }),
    [state.reload],
  )

  return (
    <main className="page wide">
      <div className="page-head">
        <div className="ns-page-head-main">
          <p className="crumb">
            <Link to="/namespaces">Namespaces</Link>
            <span aria-hidden> / </span>
            <span>{namespace}</span>
          </p>
          <div className="repo-title-identity">
            <h1 className="ns-page-title">
              {namespace} <FavoriteStar type="namespace" id={namespace} />
            </h1>
            {state.kind === 'ok' && (state.data.authz?.id || state.data.summary?.id) ? (
              <EntityIdInline
                kind="namespace"
                id={(state.data.authz?.id || state.data.summary?.id)!}
              />
            ) : null}
          </div>
          {state.kind === 'ok' && (
            <>
              {state.data.description ? (
                <p className="lede ns-page-desc">{state.data.description}</p>
              ) : (
                <p className="lede ns-page-desc muted">
                  No description yet.{' '}
                  <Link to={`${base}/settings#ns-general`}>Add one in settings</Link>
                </p>
              )}
              <div className="ns-card-info">
                <div className="ns-card-tags">
                  {!state.data.onOxen && <span className="ns-tag ns-tag-muted">Empty</span>}
                  {state.data.authz ? (
                    <span className="ns-tag">base: {state.data.authz.basePermission}</span>
                  ) : (
                    state.data.onOxen && (
                      <span className="ns-tag ns-tag-warn">no access control</span>
                    )
                  )}
                  {state.data.summary && (
                    <span className="ns-tag">
                      {state.data.summary.memberCount} member
                      {state.data.summary.memberCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {state.data.summary?.role && (
                    <span className="ns-tag ns-tag-accent">you: {state.data.summary.role}</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="ns-page-head-aside">
          {state.kind === 'ok' ? (
            <div className="storage-meter">
              <span className="storage-meter-label">Storage</span>
              <strong className="small">{state.data.storageGb.toFixed(3)} GB</strong>
              <div className="storage-meter-bar" aria-hidden>
                <span
                  style={{
                    width: `${Math.min(100, Math.max(2, state.data.storageGb || 2))}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <div className="btn-row">
            <Link className="btn primary" to={`/repos/new?namespace=${encodeURIComponent(namespace)}`}>
              <ActionFolderGit2 size={14} aria-hidden="true" className="button-label-icon" />
              New repository
            </Link>
          </div>
        </div>
      </div>

      <nav className="tab-bar ns-tab-bar" aria-label="Namespace">
        <NavLink to={base} end>
          Repositories
        </NavLink>
        <NavLink to={`${base}/settings`}>Settings</NavLink>
      </nav>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' && <Outlet context={outletContext} />}
      </StateBlock>
    </main>
  )
}
