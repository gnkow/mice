import { useMemo } from 'react'
import { FolderGit2, Layers, Monitor, Network, Plus, Terminal, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listAuthzNamespaces } from '../lib/authzApi'
import { loadCatalog } from '../lib/catalog'
import { listJobs } from '../lib/jobs'
import { listSessions } from '../lib/sessions'
import { mergeNamespaces } from '../lib/mergeNamespaces'
import { formatBytes } from '../lib/oxen/client'

type BrowseTile = {
  to: string
  createTo: string
  createLabel: string
  value: string | number
  label: string
  hint: string
  icon: LucideIcon
  span?: 'wide' | 'tall' | 'full'
}

export function HomePage() {
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const authzNs = useAsync((signal) => listAuthzNamespaces(signal), [])
  const jobs = useAsync((signal) => listJobs({ limit: 100 }, signal), [])
  const sessions = useAsync((signal) => listSessions(signal), [])

  const mergedNamespaces = useMemo(() => {
    const oxen = catalog.kind === 'ok' ? catalog.data.namespaces : []
    const authz = authzNs.kind === 'ok' ? authzNs.data.namespaces : []
    return mergeNamespaces(oxen, authz)
  }, [catalog, authzNs])

  const repositories =
    catalog.kind === 'ok' ? catalog.data.repositories : []
  const workspaces = catalog.kind === 'ok' ? catalog.data.workspaces : []
  const storageBytes = catalog.kind === 'ok' ? catalog.data.storageBytes : 0
  const jobCount = jobs.kind === 'ok' ? jobs.data.jobs.length : 0
  const sessionCount =
    sessions.kind === 'ok' ? sessions.data.sessions.length : 0

  const firstRepo = repositories[0]
  const firstRepoBase = firstRepo
    ? `/n/${encodeURIComponent(firstRepo.namespace)}/r/${encodeURIComponent(firstRepo.name)}`
    : null

  const storagePct =
    storageBytes > 0
      ? Math.min(100, (storageBytes / (50 * 1024 ** 3)) * 100)
      : 0

  // Wait for AuthZ so empty (AuthZ-only) namespaces are included in the count.
  const loading =
    catalog.kind === 'loading' ||
    (authzNs.kind === 'loading' && catalog.kind !== 'error')
  const error = catalog.kind === 'error' ? catalog.message : null

  const tiles: BrowseTile[] = [
    {
      to: '/namespaces',
      createTo: '/namespaces/new',
      createLabel: 'New namespace',
      value: mergedNamespaces.length,
      label: 'Namespaces',
      icon: Network,
      hint: 'Orgs, members, and access boundaries',
      span: 'wide',
    },
    {
      to: '/repositories',
      createTo: '/repos/new',
      createLabel: 'New repository',
      value: repositories.length,
      label: 'Repositories',
      icon: FolderGit2,
      hint: 'Versioned datasets and files',
      span: 'tall',
    },
    {
      to: '/workspaces',
      createTo: firstRepoBase
        ? `${firstRepoBase}/workspaces?new=1`
        : '/repositories',
      createLabel: 'New workspace',
      value: workspaces.length,
      label: 'Workspaces',
      icon: Layers,
      hint: 'Writable mounts on versioned data',
    },
    {
      to: '/jobs',
      createTo: firstRepoBase
        ? `${firstRepoBase}/jobs?submit=cluster`
        : '/repositories',
      createLabel: 'New job',
      value: jobs.kind === 'loading' ? '…' : jobCount,
      label: 'Jobs',
      icon: Terminal,
      hint: 'Batch compute against workspaces',
    },
    {
      to: '/sessions',
      createTo: '/sessions#sessions-create',
      createLabel: 'New session',
      value: sessions.kind === 'loading' ? '…' : sessionCount,
      label: 'Sessions',
      icon: Monitor,
      hint: 'Interactive Linux desktop containers',
      span: 'full',
    },
  ]

  return (
    <main className="page wide home-page">
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <p className="lede">
            Jump into namespaces, data, compute, and desktops.
          </p>
        </div>
        {!loading && !error && (
          <div className="storage-meter" title="Total storage used">
            <span className="storage-meter-label">Storage</span>
            <strong className="small">
              {formatBytes(storageBytes)}
              {mergedNamespaces.length > 0 ? ' reported' : ''}
            </strong>
            <div className="storage-meter-bar" aria-hidden>
              <span style={{ width: `${storagePct || 2}%` }} />
            </div>
          </div>
        )}
      </div>

      <StateBlock
        loading={loading}
        error={error}
        onRetry={() => {
          catalog.reload()
          authzNs.reload()
        }}
      >
        {!loading && !error && (
          <div className="dash-bento" role="navigation" aria-label="Browse">
            {tiles.map((tile) => (
              <div
                key={tile.to}
                className={[
                  'dash-tile',
                  tile.span === 'wide' ? 'dash-tile-wide' : '',
                  tile.span === 'tall' ? 'dash-tile-tall' : '',
                  tile.span === 'full' ? 'dash-tile-full' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <Link className="dash-tile-main" to={tile.to}>
                  <span className="dash-tile-value">{tile.value}</span>
                  <span className="dash-tile-copy">
                    <span className="dash-tile-label"><tile.icon size={22} aria-hidden="true" />{tile.label}</span>
                    <span className="dash-tile-hint">{tile.hint}</span>
                  </span>
                </Link>
                <Link
                  className="dash-tile-add"
                  to={tile.createTo}
                  aria-label={tile.createLabel}
                  title={tile.createLabel}
                >
                  <Plus size={18} aria-hidden="true" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </StateBlock>
    </main>
  )
}
