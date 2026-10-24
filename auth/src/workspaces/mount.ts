import type { SessionUser } from '../session.js'
import { authorizeRepoAction } from '../authz.js'
import { env } from '../env.js'
import { hostVolumePaths, run } from './capabilities.js'
import { LeaseError, TamperError, upperHashOf, type Lease } from './leases.js'
import type { WorkspaceService, WorkspaceState } from './workspaces.js'

export type MountSpec = {
  type: 'volume' | 'bind'
  /** Docker volume name (overlay) or host path of the plain tree (copy/reflink). */
  source: string
  target: string
  readonly: boolean
  /** `uid:gid` the guest must run as so files in upper stay manageable; null = unconfigured. */
  user: string | null
  /** Umask guests should use (group-writable). */
  umask: string
  /** Ready-to-use `docker run` arguments. */
  docker_args: string[]
  driver: WorkspaceState['driver']
  workspace_id: string
  lease_id: string
  generation: number
}

/** Docker operations the workspace layer needs; injectable for tests. */
export type DockerOps = {
  volumeExists(name: string): Promise<boolean>
  volumeCreate(name: string, opts: string[]): Promise<void>
  /** Throws DockerInUseError when containers still use the volume. */
  volumeRm(name: string): Promise<void>
  volumeList(prefix: string): Promise<string[]>
}

export class DockerInUseError extends Error {
  constructor(name: string) {
    super(`volume ${name} is in use by a container`)
    this.name = 'DockerInUseError'
  }
}

export function dockerVolumeName(ws: Pick<WorkspaceState, 'id' | 'gen'>): string {
  return `mice-ws-${ws.id}-g${ws.gen}`
}

export function realDocker(bin: string = env.jobsDockerBin): DockerOps {
  return {
    async volumeExists(name) {
      return (await run(bin, ['volume', 'inspect', name], 15_000)).ok
    },
    async volumeCreate(name, opts) {
      const r = await run(bin, ['volume', 'create', '--driver', 'local', '--name', name, ...opts.flatMap((o) => ['-o', o])], 30_000)
      if (!r.ok) throw new Error(`docker volume create failed: ${r.stderr.trim()}`)
    },
    async volumeRm(name) {
      const r = await run(bin, ['volume', 'rm', name], 30_000)
      if (r.ok) return
      if (/no such volume/i.test(r.stderr)) return
      if (/in use/i.test(r.stderr)) throw new DockerInUseError(name)
      throw new Error(`docker volume rm failed: ${r.stderr.trim()}`)
    },
    async volumeList(prefix) {
      const r = await run(bin, ['volume', 'ls', '-q', '--filter', `name=${prefix}`], 20_000)
      if (!r.ok) throw new Error(`docker volume ls failed: ${r.stderr.trim()}`)
      return r.stdout.split('\n').map((s) => s.trim()).filter((n) => n.startsWith(prefix))
    },
  }
}

const DEST_RE = /^\/[A-Za-z0-9_./@+-]*$/

export function validMountDest(dest: string): boolean {
  return DEST_RE.test(dest) && !dest.split('/').includes('..')
}

/** §4.1 overlay options for a generation volume; host paths are daemon-side. */
export function overlayVolumeOpts(host: { store: string; ws: string }, ws: WorkspaceState): string[] {
  if (!ws.lower_commit) throw new LeaseError('workspace has no lower commit', 409)
  const lower = `${host.store}/commits/${ws.namespace}/${ws.repo}/${ws.lower_commit}/tree`
  const o = [`lowerdir=${lower}`, `upperdir=${host.ws}/${ws.id}/upper`, `workdir=${host.ws}/${ws.id}/work`, 'userxattr'].join(',')
  return ['type=overlay', 'device=overlay', `o=${o}`]
}

/** Create the generation volume if it does not exist yet (idempotent). */
export async function ensureWorkspaceVolume(svc: WorkspaceService, ws: WorkspaceState): Promise<string> {
  const name = dockerVolumeName(ws)
  if (await svc.docker.volumeExists(name)) return name
  const host = await hostVolumePaths(svc.cfg)
  await svc.docker.volumeCreate(name, overlayVolumeOpts(host, ws))
  return name
}

export type MountOpts = {
  user: SessionUser
  /** Override for tests. */
  authorize?: (mode: 'ro' | 'rw', user: SessionUser, ws: WorkspaceState) => { allow: boolean; reason?: string }
}

/**
 * §4.4: produce a mount spec only for a live lease of the matching mode
 * (`ro` ↔ read lease, `rw` ↔ write lease) and re-check repo permission.
 */
export async function mountSpecFor(
  svc: WorkspaceService,
  ws: WorkspaceState,
  lease: Lease,
  mode: 'ro' | 'rw',
  dest: string,
  opts: MountOpts,
): Promise<MountSpec> {
  const live = svc.leases.get(lease.id)
  if (!live || live.workspace_id !== ws.id) throw new LeaseError('Lease not found or expired', 403)
  if (live.mode !== (mode === 'rw' ? 'write' : 'read')) {
    throw new LeaseError(`a ${mode} mount requires a ${mode === 'rw' ? 'write' : 'read'} lease`, 403)
  }
  const authz =
    opts.authorize?.(mode, opts.user, ws) ??
    (mode === 'rw'
      ? authorizeRepoAction(opts.user, ws.namespace, ws.repo, 'workspace.write')
      : authorizeRepoAction(opts.user, ws.namespace, ws.repo, 'workspace.read'))
  if (!authz.allow) throw new LeaseError(authz.reason ?? 'Forbidden', 403)
  if (ws.status !== 'ready') throw new LeaseError(`workspace is ${ws.status}`, 409)
  if (!validMountDest(dest)) throw new LeaseError('invalid mount destination', 400)

  if (mode === 'rw') await svc.prepareWritePermissions(ws)
  const cfg = svc.cfg
  const user = cfg.uid !== null && cfg.gid !== null ? `${cfg.uid}:${cfg.gid}` : null
  const readonly = mode === 'ro'
  let type: MountSpec['type']
  let source: string
  if (ws.driver === 'overlay') {
    type = 'volume'
    source = await ensureWorkspaceVolume(svc, ws)
  } else {
    type = 'bind'
    source = `${(await hostVolumePaths(cfg)).ws}/${ws.id}/tree`
  }
  const mount = `type=${type},src=${source},dst=${dest}${readonly ? ',readonly' : ''}`
  return {
    type,
    source,
    target: dest,
    readonly,
    user,
    umask: '0002',
    docker_args: ['--mount', mount, ...(user ? ['--user', user] : [])],
    driver: ws.driver,
    workspace_id: ws.id,
    lease_id: lease.id,
    generation: ws.gen,
  }
}

/** §6.1 tamper check: throws TamperError when upper changed since the write lease was granted. */
export async function verifyUpperHash(svc: WorkspaceService, ws: WorkspaceState, lease: Lease): Promise<void> {
  if (lease.mode !== 'write' || !lease.upper_hash) return
  const live = svc.leases.get(lease.id)
  if (!live) throw new LeaseError('Lease not found or expired', 403)
  const scan = await svc.scan(ws.id, { force: true })
  if (upperHashOf(scan) !== lease.upper_hash) throw new TamperError()
}

/** For file-mutation routes (W4): the caller must hold the live write lease of this workspace. */
export function requireWriteLease(svc: WorkspaceService, workspaceId: string, leaseId: string | null | undefined): Lease {
  const w = svc.leases.writer(workspaceId)
  if (!w) throw new LeaseError('a write lease is required', 423)
  if (!leaseId || leaseId !== w.id) throw new LeaseError('workspace is write-locked by another holder', 423, w.holder)
  return w
}
