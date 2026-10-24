import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Persistence seam: where JSON documents live. File in production, memory in tests. */
export interface JsonBackend {
  read(path: string): string | undefined
  write(path: string, text: string): void
}

const fileBackend: JsonBackend = {
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  },
}

export function createMemoryJsonBackend(): JsonBackend {
  const files = new Map<string, string>()
  return {
    read: (path) => files.get(path),
    write: (path, text) => void files.set(path, text),
  }
}

let backend: JsonBackend = fileBackend

/** Swap the backend; returns a function restoring the previous one. */
export function useJsonBackend(next: JsonBackend): () => void {
  const prev = backend
  backend = next
  return () => {
    backend = prev
  }
}

/** Atomic JSON read/write under AUTH_DATA_DIR (same pattern as pats.json). */
export function readJsonFile<T>(path: string, fallback: T): T {
  const raw = backend.read(path)
  if (raw === undefined) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonFile(path: string, data: unknown): void {
  backend.write(path, JSON.stringify(data, null, 2))
}
