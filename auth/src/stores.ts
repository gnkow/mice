import { appendText, lastLogSeq, protectLog, rowClear, rowGet, rowList, rowPut, rowRemove, readLogLines, readText, rewriteLogLines, writeJsonOnDisk, writeText, type LogRow } from './jsonStore.js'
import { readFileSync } from 'node:fs'

type PathSource = string | (() => string)
const resolve = (p: PathSource): string => (typeof p === 'function' ? p() : p)

/**
 * Append-only JSONL log over the persistence seam (file in production, memory in tests).
 * Corruption rule: blank and unparseable lines are skipped; every other row is returned in order.
 */
export interface JsonlLog<T> {
  append(row: T): void
  readAll(): T[]
  /** Replace every row in one atomic write; an empty list leaves an empty log. */
  rewrite(rows: T[]): void
  /** Append a pre-serialized chunk verbatim (repair tooling and corruption tests). */
  appendRaw(text: string): void
}

/** Append-only log over the persistence seam: no rewrite, no raw splice. Rows come back as raw lines so no corruption is hidden. */
export interface AppendOnlyLog<T> {
  append(row: T): void
  /** Every non-blank line in order, unparsed. */
  readLines(): string[]
  /** Rows with a sequence greater than `seq`, for consumers that keep a cursor. Sequences start at 1. */
  readAfter(seq: number): LogRow[]
  /** Sequence of the newest row; 0 when empty. */
  lastSeq(): number
}

export function createAppendOnlyLog<T>(path: PathSource): AppendOnlyLog<T> {
  return {
    append(row) {
      const target = resolve(path)
      protectLog(target)
      appendText(target, `${JSON.stringify(row)}\n`)
    },
    readLines: () => readLogLines(resolve(path), 0).map((r) => r.line),
    readAfter: (seq) => readLogLines(resolve(path), seq),
    lastSeq: () => lastLogSeq(resolve(path)),
  }
}

export function createJsonlLog<T>(path: PathSource): JsonlLog<T> {
  return {
    append: (row) => appendText(resolve(path), `${JSON.stringify(row)}\n`),
    appendRaw: (text) => appendText(resolve(path), text),
    readAll() {
      const out: T[] = []
      for (const { line } of readLogLines(resolve(path), 0)) {
        try {
          out.push(JSON.parse(line) as T)
        } catch {
          /* corrupt line: skipped by contract */
        }
      }
      return out
    },
    rewrite(rows) {
      rewriteLogLines(resolve(path), rows.map((r) => JSON.stringify(r)))
    },
  }
}

export type DocumentStoreOptions<T> = {
  path: PathSource
  initial: () => T
  /** Throws when the parsed document is structurally invalid. */
  validate?: (doc: T) => void
  /**
   * Upgrades a legacy document in place. Applied in memory on every read (reads never write);
   * persisted only by `migrate()`, and by the next transaction since that writes anyway.
   */
  migrate?: (doc: T) => void
  /** `throw` (default) surfaces unparseable or invalid JSON; `initial` treats either as absent. */
  onCorrupt?: 'throw' | 'initial'
  /** fsync data and directory on every write. */
  durable?: boolean
  /** JSON indentation; default 2. */
  space?: number
}

/** Transactional JSON document: read never writes; read-modify-write is one synchronous step. */
export interface DocumentStore<T> {
  read(): T
  /** Replace the whole document. */
  write(doc: T): void
  /** Synchronous and serialized by the single auth process; never await inside `fn`. A throw persists nothing. */
  transaction<R>(fn: (doc: T) => R): R
  /** Explicit migration point: persists the migrated document; returns whether anything changed. */
  migrate(): boolean
}

export function createDocumentStore<T>(opts: DocumentStoreOptions<T>): DocumentStore<T> {
  const load = (): { doc: T; exists: boolean; raw: string | undefined } => {
    const raw = readText(resolve(opts.path))
    if (raw === undefined) return { doc: opts.initial(), exists: false, raw }
    let doc: T
    try {
      doc = JSON.parse(raw) as T
    } catch (error) {
      if (opts.onCorrupt === 'initial') return { doc: opts.initial(), exists: false, raw }
      throw error
    }
    try {
      opts.validate?.(doc)
    } catch (error) {
      if (opts.onCorrupt === 'initial') return { doc: opts.initial(), exists: false, raw }
      throw error
    }
    opts.migrate?.(doc)
    return { doc, exists: true, raw }
  }
  const persist = (doc: T) =>
    writeText(resolve(opts.path), JSON.stringify(doc, null, opts.space ?? 2), { durable: opts.durable })

  return {
    read: () => load().doc,
    write: persist,
    transaction(fn) {
      const { doc } = load()
      const result = fn(doc)
      persist(doc)
      return result
    },
    migrate() {
      const { doc, exists, raw } = load()
      if (!exists) return false
      const next = JSON.stringify(doc, null, opts.space ?? 2)
      if (next === raw) return false
      persist(doc)
      return true
    },
  }
}

/**
 * Records identified by id: changing one record touches one record. Rows keep first-insert order.
 * Corruption rule: an unparseable row is skipped. Inside `atomically` on the database adapter, writes commit together.
 */
export interface Collection<T> {
  get(id: string): T | undefined
  put(id: string, value: T): void
  remove(id: string): boolean
  list(): T[]
  count(): number
  /** Drop every record (repair tooling and tests). */
  clear(): void
}

export function createCollection<T>(path: PathSource): Collection<T> {
  const parse = (body: string | undefined): T | undefined => {
    if (body === undefined) return undefined
    try {
      return JSON.parse(body) as T
    } catch {
      return undefined
    }
  }
  return {
    get: (id) => parse(rowGet(resolve(path), id)),
    put: (id, value) => rowPut(resolve(path), id, JSON.stringify(value)),
    remove: (id) => rowRemove(resolve(path), id),
    list: () => rowList(resolve(path)).flatMap((r) => { const v = parse(r.body); return v === undefined ? [] : [v] }),
    count: () => rowList(resolve(path)).length,
    clear: () => rowClear(resolve(path)),
  }
}

/**
 * A JSON document that stays a plain file because it describes files next to it (workspace state, leases) and is
 * removed with them. Corruption rule: a missing, unparseable or invalid file reads as absent. Writes are atomic.
 */
export interface DiskDocument<T> {
  read(): T | undefined
  write(doc: T): void
}

export function createDiskDocument<T>(path: PathSource, validate?: (value: unknown) => void): DiskDocument<T> {
  return {
    read() {
      try {
        const value = JSON.parse(readFileSync(resolve(path), 'utf8')) as T
        validate?.(value)
        return value
      } catch {
        return undefined
      }
    },
    write: (doc) => writeJsonOnDisk(resolve(path), doc),
  }
}
