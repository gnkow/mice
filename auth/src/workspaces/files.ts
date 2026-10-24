import { Readable } from 'node:stream'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { BaseIndex, ScanResult } from './scan.js'

export class PathError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Normalise a user-supplied relative path; never allows `..`, absolute paths or `.oxen`. */
export function cleanRelPath(raw: string): string {
  if (raw.includes('\0') || raw.includes('\\')) throw new PathError('invalid path')
  const segs = raw.split('/').filter((s) => s !== '')
  for (const s of segs) {
    if (s === '.' || s === '..') throw new PathError('invalid path')
    if (s === '.oxen') throw new PathError('invalid path')
  }
  return segs.join('/')
}

export type OpenedFile = { stream: Readable; size: number }

/** Open a regular file below `root` without following symlinks anywhere on the way. */
export async function openInside(root: string, rel: string): Promise<OpenedFile> {
  const clean = cleanRelPath(rel)
  if (!clean) throw new PathError('not a file', 400)
  const abs = join(root, clean)
  let real: string
  let rootReal: string
  try {
    real = await realpath(abs)
    rootReal = await realpath(root)
  } catch {
    throw new PathError('not found', 404)
  }
  if (real !== join(rootReal, clean) || !real.startsWith(rootReal + sep)) {
    throw new PathError('path resolves outside the workspace', 403)
  }
  let fh
  try {
    fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new PathError('not found', 404)
  }
  const st = await fh.stat()
  if (!st.isFile()) {
    await fh.close()
    throw new PathError('not a regular file', 400)
  }
  return { stream: fh.createReadStream({ autoClose: true }), size: st.size }
}

export type DirEntryOut = {
  name: string
  type: 'file' | 'dir'
  size: number | null
  source: 'base' | 'upper'
}

/** §5.2: merge base-manifest children with the upper scan; no lower-tree walk. */
export function effectiveListDir(
  base: BaseIndex,
  scan: ScanResult,
  dir: string,
): DirEntryOut[] | null {
  const out = new Map<string, DirEntryOut>()
  const prefix = dir ? `${dir}/` : ''
  const nameOf = (p: string) => p.slice(prefix.length)

  const baseDirHasContent = (d: string): boolean => {
    for (const f of base.filesUnder(d)) if (!scan.removedSet.has(f)) return true
    return false
  }
  const dirExists =
    dir === '' ||
    (base.dirs.has(dir) && baseDirHasContent(dir)) ||
    scan.upperDirs.has(dir) ||
    [...scan.entries.keys()].some((p) => p.startsWith(prefix))
  if (!dirExists) return null

  for (const f of base.childrenFiles(dir)) {
    if (scan.removedSet.has(f) || scan.entries.has(f)) continue
    out.set(nameOf(f), { name: nameOf(f), type: 'file', size: base.files.get(f)!.size, source: 'base' })
  }
  for (const d of base.childrenDirs(dir)) {
    if (baseDirHasContent(d)) out.set(nameOf(d), { name: nameOf(d), type: 'dir', size: null, source: 'base' })
  }
  for (const [p, e] of scan.entries) {
    if (!p.startsWith(prefix)) continue
    const rest = p.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) out.set(rest, { name: rest, type: 'file', size: e.size, source: 'upper' })
    else {
      const name = rest.slice(0, slash)
      if (!out.has(name) || out.get(name)!.type === 'dir') out.set(name, { name, type: 'dir', size: null, source: 'upper' })
    }
  }
  for (const d of scan.upperDirs) {
    if (!d.startsWith(prefix)) continue
    const rest = d.slice(prefix.length)
    if (rest && !rest.includes('/') && !out.has(rest)) out.set(rest, { name: rest, type: 'dir', size: null, source: 'upper' })
  }
  return [...out.values()].sort((a, b) => (a.type === b.type ? (a.name < b.name ? -1 : 1) : a.type === 'dir' ? -1 : 1))
}

/** Every file of the effective tree, base then upper. */
export function* effectivePaths(base: BaseIndex, scan: ScanResult): Generator<{ path: string; where: 'base' | 'upper'; size: number }> {
  for (const [p, f] of base.files) {
    if (scan.removedSet.has(p) || scan.entries.has(p)) continue
    yield { path: p, where: 'base', size: f.size }
  }
  for (const [p, e] of scan.entries) yield { path: p, where: 'upper', size: e.size }
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0'
}

function tarHeader(name: string, size: number, typeflag: string, mtime: number): Buffer {
  const h = Buffer.alloc(512)
  const nameBuf = Buffer.from(name)
  nameBuf.copy(h, 0, 0, Math.min(100, nameBuf.length))
  h.write(octal(typeflag === '5' ? 0o755 : 0o644, 8), 100)
  h.write(octal(0, 8), 108)
  h.write(octal(0, 8), 116)
  h.write(octal(size, 12), 124)
  h.write(octal(mtime, 12), 136)
  h.write('        ', 148)
  h.write(typeflag, 156)
  h.write('ustar\0', 257)
  h.write('00', 263)
  let sum = 0
  for (const b of h) sum += b
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return h
}

function* tarEntryHeader(name: string, size: number): Generator<Buffer> {
  if (Buffer.byteLength(name) > 100) {
    // GNU long-name record keeps arbitrary paths intact
    const body = Buffer.from(`${name}\0`)
    yield tarHeader('././@LongLink', body.length, 'L', 0)
    yield body
    const pad = (512 - (body.length % 512)) % 512
    if (pad) yield Buffer.alloc(pad)
  }
  yield tarHeader(name, size, '0', Math.floor(Date.now() / 1000))
}

/** Stream the effective tree as a plain tar. `open` yields the file bytes for each path. */
export async function* tarStream(
  items: Iterable<{ path: string; size: number }>,
  open: (path: string) => Promise<OpenedFile>,
): AsyncGenerator<Buffer> {
  for (const it of items) {
    const f = await open(it.path)
    yield* tarEntryHeader(it.path, f.size)
    let written = 0
    for await (const chunk of f.stream) {
      written += (chunk as Buffer).length
      yield chunk as Buffer
    }
    if (written !== f.size) throw new Error(`file changed while archiving: ${it.path}`)
    const pad = (512 - (written % 512)) % 512
    if (pad) yield Buffer.alloc(pad)
  }
  yield Buffer.alloc(1024)
}
