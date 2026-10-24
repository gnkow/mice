import { appendText, readText, writeText } from './jsonStore.js'

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

export function createJsonlLog<T>(path: PathSource): JsonlLog<T> {
  return {
    append: (row) => appendText(resolve(path), `${JSON.stringify(row)}\n`),
    appendRaw: (text) => appendText(resolve(path), text),
    readAll() {
      const out: T[] = []
      for (const line of (readText(resolve(path)) ?? '').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          out.push(JSON.parse(trimmed) as T)
        } catch {
          /* corrupt line: skipped by contract */
        }
      }
      return out
    },
    rewrite(rows) {
      writeText(resolve(path), rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
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
  /** `throw` (default) surfaces unparseable JSON; `initial` treats it as absent. */
  onCorrupt?: 'throw' | 'initial'
  /** fsync data and directory on every write. */
  durable?: boolean
  /** JSON indentation; default 2. */
  space?: number
}

/** Transactional JSON document: read never writes; read-modify-write is one synchronous step. */
export interface DocumentStore<T> {
  read(): T
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
    opts.validate?.(doc)
    opts.migrate?.(doc)
    return { doc, exists: true, raw }
  }
  const persist = (doc: T) =>
    writeText(resolve(opts.path), JSON.stringify(doc, null, opts.space ?? 2), { durable: opts.durable })

  return {
    read: () => load().doc,
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
