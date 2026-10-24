import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'
import { env } from '../env.js'
import { loadWorkspacesConfig, type WorkspacesConfig } from './config.js'
import { getfattrMarkers } from './scan.js'

export type Driver = 'overlay' | 'reflink' | 'copy'

export type Check = { ok: boolean; detail?: string }

export type Capabilities = {
  probed_at: string
  duration_ms: number
  kernel: { bff: string; docker_host: string | null; supports_userxattr: boolean | null }
  docker: Check & { version?: string; storage_driver?: string | null }
  volumes: {
    store: VolumeInfo
    workspaces: VolumeInfo
  }
  hardlink: Check
  reflink: Check
  overlay: Check & {
    userxattr?: boolean
    copy_up?: boolean
    whiteout?: boolean
    opaque?: boolean | null
    ro_mount_enforced?: boolean
    d_type?: boolean | null
  }
  getfattr: Check
  drivers: { overlay: Check; reflink: Check; copy: Check }
  /** Driver new workspaces will use. */
  driver: Driver
  driver_preference: WorkspacesConfig['driverPref']
  reasons: string[]
}

export type VolumeInfo = {
  dir: string
  fs_type: string | null
  host_path: string | null
  host_path_source: 'env' | 'docker volume inspect' | 'unresolved'
  writable: boolean
}

type ExecResult = { ok: boolean; code: number | null; stdout: string; stderr: string }

export function run(bin: string, args: string[], timeoutMs = 60_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code as number | string | undefined) : 0
      resolve({
        ok: !err,
        code: typeof code === 'number' ? code : err ? null : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '') || (err ? err.message : ''),
      })
    })
  })
}

/** Filesystem type of the mount that holds `dir` (Linux /proc/mounts, longest prefix). */
export async function fsTypeOf(dir: string): Promise<string | null> {
  try {
    const mounts = (await readFile('/proc/mounts', 'utf8')).split('\n')
    let best: { mp: string; type: string } | null = null
    for (const line of mounts) {
      const [, mp, type] = line.split(' ')
      if (!mp || !type) continue
      if ((dir === mp || dir.startsWith(mp.endsWith('/') ? mp : `${mp}/`)) && (!best || mp.length >= best.mp.length)) {
        best = { mp, type }
      }
    }
    if (best) return best.type
  } catch {
    /* not Linux */
  }
  const r = await run('stat', ['-f', '-c', '%T', dir], 5000)
  return r.ok ? r.stdout.trim() || null : null
}

export async function volumeInfo(
  dir: string,
  volume: string,
  override: string,
  bin: string,
): Promise<VolumeInfo> {
  await mkdir(dir, { recursive: true }).catch(() => undefined)
  let writable = false
  try {
    const p = join(dir, `.probe-${randomBytes(3).toString('hex')}`)
    await writeFile(p, 'x')
    await rm(p)
    writable = true
  } catch {
    /* reported via writable=false */
  }
  let host: string | null = null
  let source: VolumeInfo['host_path_source'] = 'unresolved'
  if (override) {
    host = override
    source = 'env'
  } else {
    const r = await run(bin, ['volume', 'inspect', '--format', '{{.Mountpoint}}', volume], 15_000)
    if (r.ok && r.stdout.trim()) {
      host = r.stdout.trim()
      source = 'docker volume inspect'
    }
  }
  return { dir, fs_type: await fsTypeOf(dir), host_path: host, host_path_source: source, writable }
}

function kernelAtLeast(version: string | null, major: number, minor: number): boolean | null {
  const m = version ? /^(\d+)\.(\d+)/.exec(version) : null
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  return a > major || (a === major && b >= minor)
}

async function hardlinkTest(storeDir: string): Promise<Check> {
  const id = randomBytes(3).toString('hex')
  const a = join(storeDir, 'blobs', `.probe-${id}`)
  const b = join(storeDir, 'commits', `.probe-${id}`)
  try {
    await mkdir(join(storeDir, 'blobs'), { recursive: true })
    await mkdir(join(storeDir, 'commits'), { recursive: true })
    await writeFile(a, 'probe')
    await link(a, b)
    const st = await lstat(a)
    return st.nlink === 2 ? { ok: true } : { ok: false, detail: `nlink=${st.nlink}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await rm(a, { force: true })
    await rm(b, { force: true })
  }
}

async function reflinkTest(dir: string): Promise<Check> {
  const id = randomBytes(3).toString('hex')
  const a = join(dir, `.probe-${id}-src`)
  const b = join(dir, `.probe-${id}-dst`)
  try {
    await writeFile(a, 'probe')
    await copyFile(a, b, constants.COPYFILE_FICLONE_FORCE)
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: (err as NodeJS.ErrnoException).code ?? String(err) }
  } finally {
    await rm(a, { force: true })
    await rm(b, { force: true })
  }
}

/**
 * Real overlay mount test (§11): a throwaway docker volume with overlay options,
 * mounted in a --rm container that exercises copy-up, whiteout, opaque and read-only.
 */
async function overlayTest(
  cfg: WorkspacesConfig,
  store: VolumeInfo,
  ws: VolumeInfo,
  hasGetfattr: boolean,
): Promise<Capabilities['overlay']> {
  const bin = env.jobsDockerBin
  if (!store.host_path || !ws.host_path) {
    return { ok: false, detail: 'volume host paths unresolved (docker volume inspect failed; set WORKSPACES_HOST_STORE_DIR / WORKSPACES_HOST_WS_DIR)' }
  }
  const id = randomBytes(4).toString('hex')
  const rel = `.probe-${id}`
  const lowerLocal = join(store.dir, rel, 'lower')
  const upperLocal = join(ws.dir, rel, 'upper')
  const workLocal = join(ws.dir, rel, 'work')
  const vol = `mice-probe-${id}`
  const out: Capabilities['overlay'] = { ok: false }
  try {
    await mkdir(join(lowerLocal, 'd'), { recursive: true })
    await mkdir(upperLocal, { recursive: true })
    await mkdir(workLocal, { recursive: true })
    await writeFile(join(lowerLocal, 'a.txt'), 'lower\n')
    await writeFile(join(lowerLocal, 'gone.txt'), 'lower\n')
    await writeFile(join(lowerLocal, 'd', 'f'), 'lower\n')
    const opts = [
      `lowerdir=${store.host_path}/${rel}/lower`,
      `upperdir=${ws.host_path}/${rel}/upper`,
      `workdir=${ws.host_path}/${rel}/work`,
      'userxattr',
    ].join(',')
    const created = await run(bin, ['volume', 'create', '--driver', 'local', '--name', vol, '-o', 'type=overlay', '-o', 'device=overlay', '-o', `o=${opts}`], 20_000)
    if (!created.ok) return { ok: false, detail: `volume create failed: ${created.stderr.trim()}` }
    const script =
      'set -e; cat /m/a.txt >/dev/null; echo up >> /m/a.txt; echo n > /m/new.txt; rm /m/gone.txt; rm -r /m/d; mkdir /m/d; echo y > /m/d/g; grep -q " /m overlay .*userxattr" /proc/mounts && echo USERXATTR'
    const rw = await run(bin, ['run', '--rm', '--mount', `type=volume,src=${vol},dst=/m`, cfg.probeImage, 'sh', '-c', script], 120_000)
    if (!rw.ok) {
      return { ok: false, detail: `overlay mount/exercise failed: ${(rw.stderr || rw.stdout).trim().slice(0, 400)}` }
    }
    out.userxattr = rw.stdout.includes('USERXATTR')
    // What the kernel produced, as the BFF sees it through its own volume mount.
    const upperNames = await readdir(upperLocal)
    out.copy_up = upperNames.includes('a.txt') && (await readFile(join(upperLocal, 'a.txt'), 'utf8')) === 'lower\nup\n'
    const lowerUntouched = (await readFile(join(lowerLocal, 'a.txt'), 'utf8')) === 'lower\n'
    const wh = await lstat(join(upperLocal, 'gone.txt')).catch(() => null)
    out.whiteout = !!wh && wh.isCharacterDevice() && wh.rdev === 0
    if (hasGetfattr) {
      const markers = await getfattrMarkers(upperLocal).catch(() => null)
      out.opaque = markers?.get('d')?.get('user.overlay.opaque') === '79'
    } else {
      out.opaque = null
    }
    const ro = await run(
      bin,
      ['run', '--rm', '--mount', `type=volume,src=${vol},dst=/m,readonly`, cfg.probeImage, 'sh', '-c', 'if touch /m/should-fail 2>/dev/null; then echo WROTE; else echo RO; fi'],
      120_000,
    )
    out.ro_mount_enforced = ro.ok && ro.stdout.includes('RO')
    out.d_type = true // the kernel refuses overlay on a lower/upper without d_type support
    out.ok = !!out.userxattr && !!out.copy_up && lowerUntouched && !!out.whiteout && !!out.ro_mount_enforced
    if (!out.ok) {
      out.detail = `userxattr=${out.userxattr} copy_up=${out.copy_up} lower_untouched=${lowerUntouched} whiteout=${out.whiteout} ro=${out.ro_mount_enforced}`
    }
    return out
  } catch (err) {
    return { ...out, ok: false, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    await run(bin, ['volume', 'rm', '-f', vol], 20_000)
    await rm(join(store.dir, rel), { recursive: true, force: true }).catch(() => undefined)
    await rm(join(ws.dir, rel), { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function probeCapabilities(cfg: WorkspacesConfig = loadWorkspacesConfig()): Promise<Capabilities> {
  const t0 = Date.now()
  const bin = env.jobsDockerBin
  const reasons: string[] = []

  const dockerV = await run(bin, ['version', '--format', '{{.Server.Version}}'], 15_000)
  const dockerInfo = dockerV.ok
    ? await run(bin, ['info', '--format', '{{.KernelVersion}}|{{.Driver}}'], 15_000)
    : null
  const [dockerKernel, storageDriver] = dockerInfo?.ok ? dockerInfo.stdout.trim().split('|') : [null, null]
  const docker: Capabilities['docker'] = dockerV.ok
    ? { ok: true, version: dockerV.stdout.trim(), storage_driver: storageDriver ?? null }
    : { ok: false, detail: dockerV.stderr.trim().slice(0, 300) }

  const store = await volumeInfo(cfg.storeDir, cfg.storeVolume, cfg.hostStoreDir, bin)
  const ws = await volumeInfo(cfg.wsDir, cfg.wsVolume, cfg.hostWsDir, bin)
  const hardlink = await hardlinkTest(cfg.storeDir)
  const reflink = await reflinkTest(cfg.wsDir)
  const gf = await run('getfattr', ['--version'], 5000)
  const mx = gf.ok ? gf : await run('mice-xattr', ['/nonexistent-probe'], 5000)
  const getfattr: Check = gf.ok
    ? { ok: true, detail: gf.stdout.trim().split('\n')[0] }
    : mx.stderr.includes('no such file') || mx.code === 1
      ? { ok: true, detail: 'getfattr missing; using bundled mice-xattr' }
      : { ok: false, detail: 'neither getfattr nor the bundled mice-xattr helper is available; opaque-directory detection unavailable' }

  const userxattr = kernelAtLeast(dockerKernel ?? null, 5, 11)
  let overlay: Capabilities['overlay']
  if (!docker.ok) overlay = { ok: false, detail: 'docker not reachable' }
  else if (userxattr === false) overlay = { ok: false, detail: `docker host kernel ${dockerKernel} < 5.11 (no userxattr)` }
  else if (!store.writable || !ws.writable) overlay = { ok: false, detail: 'store/workspaces directory not writable' }
  else overlay = await overlayTest(cfg, store, ws, getfattr.ok)

  if (!hardlink.ok) reasons.push(`hardlinks failed in the store: ${hardlink.detail}`)
  if (!docker.ok) reasons.push(`docker unreachable: ${docker.detail}`)
  if (!overlay.ok) reasons.push(`overlay unavailable: ${overlay.detail}`)
  if (!getfattr.ok) reasons.push(getfattr.detail ?? 'getfattr missing')
  for (const v of [store, ws]) {
    if (v.fs_type && !['ext4', 'xfs', 'btrfs', 'zfs'].includes(v.fs_type)) {
      reasons.push(`${v.dir}: filesystem ${v.fs_type} is not ext4/xfs`)
    }
  }

  const drivers: Capabilities['drivers'] = {
    overlay: overlay.ok ? { ok: true } : { ok: false, detail: overlay.detail },
    reflink: reflink,
    copy: { ok: true },
  }
  let driver: Driver
  const order: Driver[] = cfg.driverPref === 'auto' ? ['overlay', 'reflink', 'copy'] : [cfg.driverPref, 'copy']
  driver = order.find((d) => drivers[d].ok) ?? 'copy'
  if (cfg.driverPref !== 'auto' && cfg.driverPref !== driver) {
    reasons.push(`WORKSPACES_DRIVER=${cfg.driverPref} is not usable; falling back to ${driver}`)
  }
  if (driver === 'copy') reasons.push('copy driver: full copy per workspace (dev fallback)')

  return {
    probed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    kernel: { bff: release(), docker_host: dockerKernel ?? null, supports_userxattr: userxattr },
    docker,
    volumes: { store, workspaces: ws },
    hardlink,
    reflink,
    overlay,
    getfattr,
    drivers,
    driver,
    driver_preference: cfg.driverPref,
    reasons,
  }
}

let cached: { value: Capabilities; at: number } | null = null
let inflight: Promise<Capabilities> | null = null

/** Cached probe (default 10 min). Never throws. */
export async function getCapabilities(opts: { refresh?: boolean; maxAgeMs?: number } = {}): Promise<Capabilities> {
  const maxAge = opts.maxAgeMs ?? 10 * 60_000
  if (!opts.refresh && cached && Date.now() - cached.at < maxAge) return cached.value
  inflight ??= probeCapabilities()
    .then((v) => {
      cached = { value: v, at: Date.now() }
      return v
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function cachedCapabilities(): Capabilities | null {
  return cached?.value ?? null
}

export function setCapabilitiesForTest(v: Capabilities | null): void {
  cached = v ? { value: v, at: Date.now() } : null
}

export async function logCapabilities(): Promise<void> {
  try {
    const c = await getCapabilities({ refresh: true })
    console.log(
      `[mice-auth] workspaces: driver=${c.driver} overlay=${c.overlay.ok ? 'ok' : 'unavailable'} ` +
        `docker=${c.docker.ok} hardlink=${c.hardlink.ok} getfattr=${c.getfattr.ok} ` +
        `store=${c.volumes.store.fs_type} ws=${c.volumes.workspaces.fs_type} (${c.duration_ms}ms)`,
    )
    for (const r of c.reasons) console.log(`[mice-auth] workspaces: ${r}`)
  } catch (err) {
    console.error('[mice-auth] workspaces capability probe failed (non-fatal)', err)
  }
}

/** Host (docker daemon side) roots of the store and workspaces volumes; cached. */
let hostPathsCache: { store: string; ws: string } | null = null
export async function hostVolumePaths(cfg: WorkspacesConfig = loadWorkspacesConfig()): Promise<{ store: string; ws: string }> {
  if (hostPathsCache) return hostPathsCache
  const bin = env.jobsDockerBin
  const store = await volumeInfo(cfg.storeDir, cfg.storeVolume, cfg.hostStoreDir, bin)
  const ws = await volumeInfo(cfg.wsDir, cfg.wsVolume, cfg.hostWsDir, bin)
  if (!store.host_path || !ws.host_path) {
    throw new Error('volume host paths unresolved (set WORKSPACES_HOST_STORE_DIR / WORKSPACES_HOST_WS_DIR)')
  }
  hostPathsCache = { store: store.host_path, ws: ws.host_path }
  return hostPathsCache
}
export function resetHostVolumePathsForTest(v: { store: string; ws: string } | null): void {
  hostPathsCache = v
}
