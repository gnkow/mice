import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

/** Persistence seam: where JSON documents live. File in production, memory in tests. */
export interface JsonBackend {
  read(path: string): string | undefined
  /** `durable` asks for fsync of data and directory before returning (file backend only). */
  write(path: string, text: string, opts?: { durable?: boolean }): void
  /** Optional; callers fall back to read + write when a backend omits it. */
  append?(path: string, text: string): void
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

export function readText(path: string): string | undefined {
  return backend.read(path)
}

export function writeText(path: string, text: string, opts?: { durable?: boolean }): void {
  backend.write(path, text, opts)
}

export function appendText(path: string, text: string): void {
  if (backend.append) backend.append(path, text)
  else backend.write(path, (backend.read(path) ?? '') + text)
}
