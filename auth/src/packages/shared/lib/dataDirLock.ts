import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCK_NAME = '.mice-auth.lock'

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Workspace state on disk assumes a single writer; refuse to share a data directory between live processes. */
export function acquireDataDirLock(
  dir: string,
  opts: { pid?: number; isAlive?: (pid: number) => boolean } = {},
): { release: () => void } {
  const pid = opts.pid ?? process.pid
  const isAlive = opts.isAlive ?? processAlive
  const path = join(dir, LOCK_NAME)
  mkdirSync(dir, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(pid), { flag: 'wx' })
      return { release: () => rmSync(path, { force: true }) }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const holder = Number(readFileSync(path, 'utf8').trim())
      if (Number.isInteger(holder) && holder > 0 && holder !== pid && isAlive(holder)) {
        throw new Error(`AUTH_DATA_DIR "${dir}" is already in use by process ${holder} (single BFF replica only)`)
      }
      rmSync(path, { force: true })
    }
  }
  throw new Error(`Could not acquire the lock in AUTH_DATA_DIR "${dir}"`)
}
