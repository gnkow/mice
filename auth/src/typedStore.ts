import { readJsonFile, writeJsonFile } from './jsonStore.js'

export type TypedStore<T> = {
  /** The stored document, or a fresh default when the file is missing, corrupt or fails `valid`. */
  read(): T
  write(doc: T): void
  /** Read-modify-write; `fn` may mutate and return nothing, or return a replacement. Returns `fn`'s result. */
  update<R = void>(fn: (doc: T) => R): R
}

/**
 * One JSON document under AUTH_DATA_DIR with a default and a validity check (e.g. version),
 * so each store does not repeat its own read/validate/write code.
 */
export function defineStore<T>(opts: {
  file: () => string
  empty: () => T
  valid: (raw: unknown) => boolean
}): TypedStore<T> {
  const read = (): T => {
    const raw = readJsonFile<unknown>(opts.file(), null)
    return opts.valid(raw) ? (raw as T) : opts.empty()
  }
  return {
    read,
    write: (doc) => writeJsonFile(opts.file(), doc),
    update(fn) {
      const doc = read()
      const result = fn(doc)
      writeJsonFile(opts.file(), doc)
      return result
    },
  }
}
