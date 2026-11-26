import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type PathSource = string | (() => string)
const resolve = (p: PathSource): string => (typeof p === 'function' ? p() : p)

/**
 * JSON that must sit beside the files it describes (workspace trees, checkout caches), so it is copied and
 * removed together with them. The write is atomic: a temp file, then a rename.
 */
export function writeJsonOnDisk(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * A JSON document that stays a plain file because it describes files next to it (workspace state, leases).
 * Corruption rule: a missing, unparseable or invalid file reads as absent.
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

/** Readiness of the workspace disk: the data directory must take a write. Read at call time, like the lock. */
export function diskReadiness(): { ok: boolean; detail?: string } {
  const dir = (process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, '')
  const probe = join(dir, `.ready-${process.pid}`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(probe, '')
    rmSync(probe)
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
}
