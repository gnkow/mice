import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export type BaseFile = { size: number; sha256: string }
export type PathSize = { path: string; size: number }
export type Changes = {
  added: PathSize[]
  modified: PathSize[]
  removed: PathSize[]
  special: Array<{ path: string; kind: string }>
  upper_bytes: number
  files: number
  scanned_at: string
  warnings: string[]
}
export type UpperEntry = { size: number; sha256: string; mtimeMs: number }
export type ScanResult = Changes & {
  /** Every regular file in upper (including unchanged copy-ups). */
  entries: Map<string, UpperEntry>
  /** Paths hidden from the lower layer (whiteouts + opaque/replace coverage), as base file paths. */
  removedSet: Set<string>
  whiteouts: Set<string>
  opaque: Set<string>
  upperDirs: Set<string>
}

export class ScanError extends Error {}

export type Markers = Map<string, Map<string, string>>
export type MarkerReader = (upperDir: string) => Promise<Markers | null>

/** Directory-grouped view of the base manifest; avoids scanning every path per query. */
export class BaseIndex {
  readonly dirs = new Set<string>([''])
  private readonly byDir = new Map<string, string[]>()
  private readonly subdirs = new Map<string, string[]>()
  constructor(readonly files: Map<string, BaseFile>) {
    for (const p of files.keys()) {
      let parent = ''
      const parts = p.split('/')
      for (let i = 0; i < parts.length - 1; i += 1) {
        const dir = parts.slice(0, i + 1).join('/')
        if (!this.dirs.has(dir)) {
          this.dirs.add(dir)
          const l = this.subdirs.get(parent)
          if (l) l.push(dir)
          else this.subdirs.set(parent, [dir])
        }
        parent = dir
      }
      const l = this.byDir.get(parent)
      if (l) l.push(p)
      else this.byDir.set(parent, [p])
    }
  }
  childrenFiles(dir: string): string[] {
    return this.byDir.get(dir) ?? []
  }
  childrenDirs(dir: string): string[] {
    return this.subdirs.get(dir) ?? []
  }
  *filesUnder(dir: string): Generator<string> {
    for (const f of this.childrenFiles(dir)) yield f
    for (const d of this.childrenDirs(dir)) yield* this.filesUnder(d)
  }
}

/** Decode getfattr's `\ooo` escapes (bytes) into a string; anything else is a parse error. */
function decodeGetfattrName(raw: string): string {
  const bytes: number[] = []
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i]!
    if (ch === '\\') {
      const oct = raw.slice(i + 1, i + 4)
      if (!/^[0-7]{3}$/.test(oct)) throw new ScanError(`bad escape in getfattr output: ${JSON.stringify(raw)}`)
      bytes.push(parseInt(oct, 8))
      i += 4
    } else {
      const cp = raw.codePointAt(i)!
      bytes.push(...Buffer.from(String.fromCodePoint(cp), 'utf8'))
      i += cp > 0xffff ? 2 : 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Strict parser for `getfattr -R -h -e hex --absolute-names` output. */
export function parseGetfattr(output: string, root: string): Markers {
  const out: Markers = new Map()
  let current: Map<string, string> | null = null
  for (const line of output.split('\n')) {
    if (line === '') {
      current = null
      continue
    }
    if (line.startsWith('# file: ')) {
      const abs = decodeGetfattrPath(line.slice('# file: '.length))
      let rel: string
      if (abs === root) rel = ''
      else if (abs.startsWith(`${root}/`)) rel = abs.slice(root.length + 1)
      else throw new ScanError(`getfattr path outside upper: ${JSON.stringify(abs)}`)
      current = out.get(rel) ?? new Map()
      out.set(rel, current)
      continue
    }
    const m = /^([^=\s]+)(?:=0x([0-9a-fA-F]*))?$/.exec(line)
    if (!m || !current) throw new ScanError(`unparseable getfattr line: ${JSON.stringify(line)}`)
    current.set(m[1]!, (m[2] ?? '').toLowerCase())
  }
  return out
}

function decodeGetfattrPath(raw: string): string {
  // getfattr may wrap the name in double quotes when it escapes characters.
  const unquoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  return decodeGetfattrName(unquoted)
}

/** One `getfattr -R` call over upper. null = tool missing (opaque markers unknown). */
function runMarkerTool(bin: string, args: string[], upperDir: string): Promise<Markers | null> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve(null)
      if (err && !stdout) return reject(new ScanError(`${bin} failed: ${err.message}`))
      try {
        resolve(parseGetfattr(stdout, upperDir))
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * One call over upper. Prefers `getfattr`, falls back to the bundled `mice-xattr`
 * (same output format). null = neither available (opaque markers unknown).
 */
export const getfattrMarkers: MarkerReader = async (upperDir) => {
  const viaGetfattr = await runMarkerTool(
    'getfattr',
    ['-R', '-h', '-m', '^user\\.overlay\\.', '-e', 'hex', '--absolute-names', upperDir],
    upperDir,
  )
  if (viaGetfattr) return viaGetfattr
  return runMarkerTool('mice-xattr', [upperDir], upperDir)
}

type CacheRow = { ino: string; size: number; mtime_ns: string; sha: string }

async function hashNoFollow(path: string): Promise<string> {
  const fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const h = createHash('sha256')
    await pipeline(fh.createReadStream({ autoClose: false }), h)
    return h.digest('hex')
  } finally {
    await fh.close()
  }
}

const REHASH_WINDOW_MS = 2000

/**
 * §5.1: compute changes of an overlay upper dir against the base manifest.
 * Cost is proportional to upper, never to the lower tree.
 */
export async function scanUpper(opts: {
  upper: string
  base: BaseIndex
  cachePath?: string
  readMarkers?: MarkerReader
  now?: number
}): Promise<ScanResult> {
  const now = opts.now ?? Date.now()
  const cache: Record<string, CacheRow> = opts.cachePath
    ? await readFile(opts.cachePath, 'utf8').then(
        (t) => JSON.parse(t) as Record<string, CacheRow>,
        () => ({}),
      )
    : {}
  const nextCache: Record<string, CacheRow> = {}
  const entries = new Map<string, UpperEntry>()
  const whiteouts = new Set<string>()
  const upperDirs = new Set<string>()
  const special: Array<{ path: string; kind: string }> = []
  let upperBytes = 0

  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(opts.upper, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = join(opts.upper, r)
      const st = await lstat(abs, { bigint: true })
      if (st.isDirectory()) {
        upperDirs.add(r)
        await walk(r)
      } else if (st.isFile()) {
        const size = Number(st.size)
        const mtimeMs = Number(st.mtimeNs / 1_000_000n)
        const key = `${st.ino}`
        const hit = cache[r]
        let sha: string
        if (hit && hit.ino === key && hit.size === size && hit.mtime_ns === `${st.mtimeNs}` && now - mtimeMs > REHASH_WINDOW_MS) {
          sha = hit.sha
        } else {
          sha = await hashNoFollow(abs)
        }
        nextCache[r] = { ino: key, size, mtime_ns: `${st.mtimeNs}`, sha }
        entries.set(r, { size, sha256: sha, mtimeMs })
        upperBytes += size
      } else if (st.isCharacterDevice() && st.rdev === 0n) {
        whiteouts.add(r)
      } else {
        special.push({
          path: r,
          kind: st.isSymbolicLink() ? 'symlink' : st.isFIFO() ? 'fifo' : st.isSocket() ? 'socket' : 'device',
        })
      }
    }
  }
  await walk('')

  const warnings: string[] = []
  const opaque = new Set<string>()
  const markers = await (opts.readMarkers ?? getfattrMarkers)(opts.upper)
  if (markers) {
    for (const [p, attrs] of markers) {
      if (attrs.get('user.overlay.opaque') === '79' && p !== '') opaque.add(p)
      // xattr-style whiteout (overlayfs on kernels that cannot mknod a chardev)
      if (attrs.has('user.overlay.whiteout') && entries.has(p)) {
        const e = entries.get(p)!
        upperBytes -= e.size
        entries.delete(p)
        whiteouts.add(p)
      }
    }
  } else if ([...upperDirs].some((d) => opts.base.dirs.has(d))) {
    warnings.push('opaque directory markers unreadable (getfattr not installed): opaque directories are treated as merged')
  }

  const removedSet = new Set<string>()
  const baseFiles = opts.base.files
  for (const w of whiteouts) {
    if (baseFiles.has(w)) removedSet.add(w)
    if (opts.base.dirs.has(w)) for (const p of opts.base.filesUnder(w)) removedSet.add(p)
  }
  for (const o of opaque) {
    if (!opts.base.dirs.has(o)) continue
    for (const p of opts.base.filesUnder(o)) if (!entries.has(p)) removedSet.add(p)
  }
  for (const p of entries.keys()) {
    // a file in upper replaces a whole lower directory of the same name
    if (opts.base.dirs.has(p) && p !== '') for (const q of opts.base.filesUnder(p)) removedSet.add(q)
  }
  for (const d of upperDirs) {
    // a directory in upper replaces a lower file of the same name
    if (baseFiles.has(d)) removedSet.add(d)
  }

  const added: PathSize[] = []
  const modified: PathSize[] = []
  for (const [p, e] of entries) {
    const b = baseFiles.get(p)
    if (!b) added.push({ path: p, size: e.size })
    else if (b.sha256 !== e.sha256) modified.push({ path: p, size: e.size })
  }
  const removed: PathSize[] = [...removedSet].map((p) => ({ path: p, size: baseFiles.get(p)?.size ?? 0 }))
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  added.sort(byPath)
  modified.sort(byPath)
  removed.sort(byPath)
  special.sort(byPath)

  if (opts.cachePath) {
    await writeFile(opts.cachePath, JSON.stringify(nextCache)).catch(() => undefined)
  }
  return {
    added,
    modified,
    removed,
    special,
    upper_bytes: upperBytes,
    files: entries.size,
    scanned_at: new Date(now).toISOString(),
    warnings,
    entries,
    removedSet,
    whiteouts,
    opaque,
    upperDirs,
  }
}

/** copy/reflink drivers: diff a plain `tree/` against the base manifest (§4.2). */
export async function scanTree(opts: {
  tree: string
  base: BaseIndex
  cachePath?: string
  now?: number
}): Promise<ScanResult> {
  const now = opts.now ?? Date.now()
  const cache: Record<string, CacheRow> = opts.cachePath
    ? await readFile(opts.cachePath, 'utf8').then(
        (t) => JSON.parse(t) as Record<string, CacheRow>,
        () => ({}),
      )
    : {}
  const nextCache: Record<string, CacheRow> = {}
  const entries = new Map<string, UpperEntry>()
  const special: Array<{ path: string; kind: string }> = []
  const upperDirs = new Set<string>()
  const walk = async (rel: string): Promise<void> => {
    for (const e of await readdir(join(opts.tree, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = join(opts.tree, r)
      const st = await lstat(abs, { bigint: true })
      if (st.isDirectory()) {
        upperDirs.add(r)
        await walk(r)
      } else if (st.isFile()) {
        const size = Number(st.size)
        const mtimeMs = Number(st.mtimeNs / 1_000_000n)
        const hit = cache[r]
        const sha =
          hit && hit.ino === `${st.ino}` && hit.size === size && hit.mtime_ns === `${st.mtimeNs}` && now - mtimeMs > REHASH_WINDOW_MS
            ? hit.sha
            : await hashNoFollow(abs)
        nextCache[r] = { ino: `${st.ino}`, size, mtime_ns: `${st.mtimeNs}`, sha }
        entries.set(r, { size, sha256: sha, mtimeMs })
      } else {
        special.push({ path: r, kind: st.isSymbolicLink() ? 'symlink' : 'special' })
      }
    }
  }
  await walk('')
  const added: PathSize[] = []
  const modified: PathSize[] = []
  const removed: PathSize[] = []
  for (const [p, e] of entries) {
    const b = opts.base.files.get(p)
    if (!b) added.push({ path: p, size: e.size })
    else if (b.sha256 !== e.sha256) modified.push({ path: p, size: e.size })
  }
  const removedSet = new Set<string>()
  for (const [p, b] of opts.base.files) {
    if (!entries.has(p)) {
      removed.push({ path: p, size: b.size })
      removedSet.add(p)
    }
  }
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  added.sort(byPath)
  modified.sort(byPath)
  removed.sort(byPath)
  if (opts.cachePath) await writeFile(opts.cachePath, JSON.stringify(nextCache)).catch(() => undefined)
  // upper_bytes = bytes of changed content (what the user has actually diverged by)
  const upperBytes = [...added, ...modified].reduce((a, f) => a + f.size, 0)
  return {
    added,
    modified,
    removed,
    special,
    upper_bytes: upperBytes,
    files: entries.size,
    scanned_at: new Date(now).toISOString(),
    warnings: [],
    entries,
    removedSet,
    whiteouts: new Set(),
    opaque: new Set(),
    upperDirs,
  }
}
