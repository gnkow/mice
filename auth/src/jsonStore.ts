import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { createSqliteBackend, type SqliteBackend } from './sqliteBackend.js'

/** Persistence seam: where JSON documents live. File in production, memory in tests. */
export interface JsonBackend {
  read(path: string): string | undefined
  /** `durable` asks for fsync of data and directory before returning (file backend only). */
  write(path: string, text: string, opts?: { durable?: boolean }): void
  /** Optional; callers fall back to read + write when a backend omits it. */
  append?(path: string, text: string): void
  /** Optional; adapters that store rows natively return them without re-splitting text. */
  readLines?(path: string, afterSeq: number): LogRow[]
  lastSeq?(path: string): number
  /** Optional; replaces every row of a log in one step. */
  rewriteLines?(path: string, lines: string[]): void
  /** Optional record-by-id storage for collections; adapters without it fall back to one JSON document. */
  rowGet?(coll: string, id: string): string | undefined
  rowPut?(coll: string, id: string, body: string): void
  rowRemove?(coll: string, id: string): boolean
  rowList?(coll: string): { id: string; body: string }[]
  rowClear?(coll: string): void
  /** Optional; throws when storage cannot take a write. */
  probe?(): void
  /** Optional; makes a log reject rewrite and removal in storage. */
  protectLog?(path: string): void
  /** Optional; drops a document or log entirely. */
  remove?(path: string): void
  /** Optional; all writes inside `fn` commit together or not at all. */
  atomically?<R>(fn: () => R): R
}

/** One log row: `seq` counts complete non-blank lines from 1 and never changes once written. */
export type LogRow = { seq: number; line: string }

/** Plain files, one per path. Production data now lives in SQLite; this adapter reads legacy files for the import. */
export function createFileJsonBackend(): JsonBackend {
  return fileBackend
}

const fileBackend: JsonBackend = {
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  write(path, text, opts) {
    if (opts?.durable) return writeDurable(path, text)
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  },
  append(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, text, 'utf8')
  },
  remove(path) {
    rmSync(path, { force: true })
  },
}

function writeDurable(path: string, text: string): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const staging = join(dir, `.${basename(path)}-${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(staging, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(staging, path)
    const directory = openSync(dir, 'r')
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(staging)) unlinkSync(staging)
  }
}

export function createMemoryJsonBackend(): JsonBackend {
  const files = new Map<string, string>()
  return {
    read: (path) => files.get(path),
    write: (path, text) => void files.set(path, text),
    append: (path, text) => void files.set(path, (files.get(path) ?? '') + text),
    remove: (path) => void files.delete(path),
  }
}

let override: JsonBackend | undefined
let database: { path: string; backend: SqliteBackend } | undefined

/**
 * Where the production database lives: AUTH_DATABASE_PATH, else mice.db under AUTH_DATA_DIR. Read from the
 * process environment on every call because this module loads before `env` and tests set the variables late.
 */
export function databasePath(): string {
  return process.env.AUTH_DATABASE_PATH || join((process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, ''), 'mice.db')
}

function current(): JsonBackend {
  if (override) return override
  const path = databasePath()
  if (database?.path !== path) {
    database?.backend.close()
    database = { path, backend: createSqliteBackend(path) }
  }
  return database.backend
}

/** The open production database, for operations only SQLite has (backup, readiness, import). */
export function openDatabase(): SqliteBackend {
  if (override) throw new Error('A test backend is installed; there is no database')
  current()
  return database!.backend
}

export function closeDatabase(): void {
  database?.backend.close()
  database = undefined
}

/** Swap the backend; returns a function restoring the previous one. */
export function useJsonBackend(next: JsonBackend): () => void {
  const prev = override
  override = next
  return () => {
    override = prev
  }
}

export function readText(path: string): string | undefined {
  return current().read(path)
}

export function writeText(path: string, text: string, opts?: { durable?: boolean }): void {
  current().write(path, text, opts)
}

export function appendText(path: string, text: string): void {
  const b = current()
  if (b.append) b.append(path, text)
  else b.write(path, (b.read(path) ?? '') + text)
}

/** Complete, non-blank lines after `afterSeq`. A final line without a newline is a partial append and is not returned. */
export function readLogLines(path: string, afterSeq = 0): LogRow[] {
  const b = current()
  if (b.readLines) return b.readLines(path, afterSeq)
  const text = b.read(path) ?? ''
  const complete = text.slice(0, text.lastIndexOf('\n') + 1)
  const rows: LogRow[] = []
  let seq = 0
  for (const raw of complete.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    seq += 1
    if (seq > afterSeq) rows.push({ seq, line })
  }
  return rows
}

export function lastLogSeq(path: string): number {
  const b = current()
  if (b.lastSeq) return b.lastSeq(path)
  return readLogLines(path, 0).at(-1)?.seq ?? 0
}

/** Row sequence of the last complete line that ends at or before `byteOffset` (upgrades legacy byte cursors). */
export function seqForByteOffset(text: string, byteOffset: number): number {
  const head = Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8')
  const complete = head.slice(0, head.lastIndexOf('\n') + 1)
  return complete.split('\n').filter((l) => l.trim()).length
}

/** Replace every row of a log in one atomic step. */
export function rewriteLogLines(path: string, lines: string[]): void {
  const b = current()
  if (b.rewriteLines) b.rewriteLines(path, lines)
  else b.write(path, lines.map((l) => `${l}\n`).join(''))
}

/** Group writes across documents and logs so they commit together; adapters without transactions just run `fn`. */
export function atomically<R>(fn: () => R): R {
  const b = current()
  return b.atomically ? b.atomically(fn) : fn()
}

/**
 * JSON that must sit beside the files it describes (workspace trees, checkout caches), so it is copied and
 * removed together with them. These stay plain files; everything else goes through the database.
 */
export function writeJsonOnDisk(path: string, data: unknown): void {
  fileBackend.write(path, JSON.stringify(data, null, 2))
}

/** Delete a document or log. Used by repair tooling and tests; stores never call it. */
export function removeText(path: string): void {
  const b = current()
  if (b.remove) b.remove(path)
  else b.write(path, '')
}

/** Ask the adapter to enforce append-only on a log; adapters without storage-level enforcement rely on the interface. */
export function protectLog(path: string): void {
  current().protectLog?.(path)
}

/** Readiness of the storage behind the seam: a throwing write probe means it cannot take writes. */
export function storageReadiness(): { ok: boolean; detail?: string } {
  try {
    current().probe?.()
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}

type PairDoc = [string, string][]
const fallbackPath = (coll: string) => `${coll}.collection.json`
function loadPairs(b: JsonBackend, coll: string): PairDoc {
  const raw = b.read(fallbackPath(coll))
  if (raw === undefined) return []
  try {
    return JSON.parse(raw) as PairDoc
  } catch {
    return []
  }
}
const savePairs = (b: JsonBackend, coll: string, pairs: PairDoc) => b.write(fallbackPath(coll), JSON.stringify(pairs))

/** Record-by-id storage (collections). Rows keep first-insert order; a replaced row stays in place. */
export function rowGet(coll: string, id: string): string | undefined {
  const b = current()
  return b.rowGet ? b.rowGet(coll, id) : loadPairs(b, coll).find(([k]) => k === id)?.[1]
}
export function rowPut(coll: string, id: string, body: string): void {
  const b = current()
  if (b.rowPut) return b.rowPut(coll, id, body)
  const pairs = loadPairs(b, coll)
  const at = pairs.findIndex(([k]) => k === id)
  if (at >= 0) pairs[at] = [id, body]
  else pairs.push([id, body])
  savePairs(b, coll, pairs)
}
export function rowRemove(coll: string, id: string): boolean {
  const b = current()
  if (b.rowRemove) return b.rowRemove(coll, id)
  const pairs = loadPairs(b, coll)
  const next = pairs.filter(([k]) => k !== id)
  if (next.length === pairs.length) return false
  savePairs(b, coll, next)
  return true
}
export function rowList(coll: string): { id: string; body: string }[] {
  const b = current()
  return b.rowList ? b.rowList(coll) : loadPairs(b, coll).map(([id, body]) => ({ id, body }))
}
export function rowClear(coll: string): void {
  const b = current()
  if (b.rowClear) b.rowClear(coll)
  else b.remove ? b.remove(fallbackPath(coll)) : b.write(fallbackPath(coll), '[]')
}
