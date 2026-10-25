import { createHash } from 'node:crypto'
import type { AppendOnlyLog } from './stores.js'

export const GENESIS_PREV_HASH = '0'.repeat(64)

export type ChainLinks = { prev_hash: string; hash: string }
type Row = Record<string, unknown> & { id?: string }

export type ChainBreak = {
  /** Zero-based position among non-blank lines (the genesis event is 0). */
  index: number
  id?: string
  reason: string
}

export type Verification =
  | { ok: true; events: number; lastHash: string }
  | { ok: false; events: number; firstBreak: ChainBreak }

export class AuditStoreError extends Error {}

/** JSON with object keys sorted recursively, so a hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashOf(row: Row): string {
  const { hash: _hash, ...rest } = row
  return createHash('sha256').update(canonicalJson(rest)).digest('hex')
}

function parse(line: string): Row | undefined {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : undefined
  } catch {
    return undefined
  }
}

const isChained = (r: Row): boolean => typeof r.hash === 'string' && typeof r.prev_hash === 'string'

/**
 * Hash chain over an append-only log. Each row stores `prev_hash` and `hash` (SHA-256 over the
 * canonical JSON of the row without `hash`). Reading the tail and appending happen in one
 * synchronous critical section, so the chain cannot fork inside this process; the data-directory
 * lock keeps other processes out.
 */
export function createAuditChain<E extends Row>(
  log: AppendOnlyLog<E & ChainLinks>,
  makeGenesis: () => E,
) {
  let writing = false

  function link(row: E, prev: string): E & ChainLinks {
    const withPrev = { ...row, prev_hash: prev }
    return { ...withPrev, hash: hashOf(withPrev) } as E & ChainLinks
  }

  function tailOf(lines: string[]): Row | undefined {
    const last = lines[lines.length - 1]
    return last === undefined ? undefined : parse(last)
  }

  return {
    append(partial: E): E & ChainLinks {
      if (writing) throw new AuditStoreError('audit writer is busy (re-entrant append)')
      writing = true
      try {
        const lines = log.readLines()
        let prev = GENESIS_PREV_HASH
        if (lines.length === 0) {
          const genesis = link(makeGenesis(), GENESIS_PREV_HASH)
          log.append(genesis)
          prev = genesis.hash
        } else {
          const tail = tailOf(lines)
          if (!tail || !isChained(tail)) {
            throw new AuditStoreError('audit log tail is not hash-chained; refusing to append')
          }
          prev = tail.hash as string
        }
        const event = link(partial, prev)
        log.append(event)
        return event
      } finally {
        writing = false
      }
    },

    /** Throws when the log is non-empty but its first row carries no hashes; writes genesis when empty. */
    ensureGenesis(): void {
      const lines = log.readLines()
      if (lines.length === 0) {
        log.append(link(makeGenesis(), GENESIS_PREV_HASH))
        return
      }
      const first = parse(lines[0]!)
      if (!first || !isChained(first)) {
        throw new AuditStoreError(
          'audit.jsonl is not empty and not hash-chained (unchained legacy history). Refusing to adopt or rewrite it; archive or remove the file deliberately before starting.',
        )
      }
    },

    /** The stored hash of every event, in order (an unreadable line yields an empty string). */
    hashes(): string[] {
      return log.readLines().map((l) => {
        const row = parse(l)
        return row && typeof row.hash === 'string' ? row.hash : ''
      })
    },

    verify(): Verification {
      const lines = log.readLines()
      let prev = GENESIS_PREV_HASH
      for (let index = 0; index < lines.length; index++) {
        const row = parse(lines[index]!)
        const fail = (reason: string): Verification => ({
          ok: false,
          events: lines.length,
          firstBreak: { index, ...(row && typeof row.id === 'string' ? { id: row.id } : {}), reason },
        })
        if (!row) return fail('line cannot be parsed as an event')
        if (!isChained(row)) return fail('event has no prev_hash/hash')
        if (row.prev_hash !== prev) {
          return fail(
            index === 0
              ? 'first event is not a genesis event'
              : 'prev_hash does not match the previous hash (event removed, inserted or reordered)',
          )
        }
        if (row.hash !== hashOf(row)) return fail('hash mismatch (event content was altered)')
        prev = row.hash as string
      }
      return { ok: true, events: lines.length, lastHash: prev }
    },
  }
}
