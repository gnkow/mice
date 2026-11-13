import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ImmudbModule from 'immudb-node'

export type ImmudbConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** Every record key starts with this; tests use a private prefix inside a shared database. */
  prefix: string
}

function passwordFrom(src: NodeJS.ProcessEnv): string {
  if (src.IMMUDB_PASSWORD) return src.IMMUDB_PASSWORD
  const found = [
    src.IMMUDB_PASSWORD_FILE,
    '/run/secrets/immudb_password',
    resolve(process.cwd(), '.secrets/immudb-password'),
    resolve(process.cwd(), '../.secrets/immudb-password'),
  ]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(p))
  if (!found) throw new Error('immudb password not found: set IMMUDB_PASSWORD or IMMUDB_PASSWORD_FILE, or run `make db-secrets`')
  return readFileSync(found, 'utf8').trim()
}

/** Connection settings for the audit ledger; the same shape locally and in containers. */
export function immudbConfig(src: NodeJS.ProcessEnv = process.env): ImmudbConfig {
  return {
    host: src.IMMUDB_HOST ?? '127.0.0.1',
    port: Number(src.IMMUDB_PORT ?? 3322),
    user: src.IMMUDB_USER ?? 'immudb',
    password: passwordFrom(src),
    database: src.IMMUDB_DATABASE ?? 'audit',
    prefix: src.IMMUDB_KEY_PREFIX ?? 'audit/',
  }
}

export type LedgerRecord = { seq: number; key: string; value: string }

export type LedgerVerification =
  | { ok: true; events: number; head: number; verifiedAt: string }
  | { ok: false; events: number; verifiedAt: string; firstBreak: { seq: number; reason: string } }

export type LedgerHealth = { ok: true } | { ok: false; detail: string }

export type LedgerProof = {
  seq: number
  valid: boolean
  /** Accumulated linear hash of the record's transaction (hex), which chains it to all earlier history. */
  transactionHash: string
  previousTransactionHash: string
  entryRoot: string
}

type TxMetadata = { id: number; prevalh: string; ts: number; nentries: number; eh: string; bltxid: number; blroot: string }
export type LedgerTx = { metadata: TxMetadata; entriesList: { key: string; hvalue: string }[] }

export type VerifyOptions = {
  /** Number of most recent transactions to walk; defaults to all of them. */
  window?: number
  /** Test seams that corrupt what the server returned, to prove tampering is detected. */
  tamper?: (record: LedgerRecord) => LedgerRecord
  tamperTx?: (tx: LedgerTx, index: number) => LedgerTx
}

export type Ledger = {
  /** Stores a record and returns its sequence number (the immudb transaction id). */
  append(id: string, value: string): Promise<number>
  /** Every record under this ledger's prefix, oldest first. */
  readAll(): Promise<LedgerRecord[]>
  /** Records under this prefix written after `seq`, oldest first, from the transaction log; at most `limit` transactions are examined. */
  readAfter(seq: number, limit?: number): Promise<{ records: LedgerRecord[]; scannedTo: number }>
  verify(opts?: VerifyOptions): Promise<LedgerVerification>
  /** Checks one record against its transaction hash and root; undefined when the record does not exist. */
  prove(id: string, opts?: { tamper?: (record: LedgerRecord) => LedgerRecord }): Promise<LedgerProof | undefined>
  health(): Promise<LedgerHealth>
  close(): Promise<void>
}

type Client = {
  login(p: { user: string; password: string }): Promise<unknown>
  listDatabases(): Promise<{ databasesList: { databasename: string }[] }>
  createDatabase(p: { databasename: string }): Promise<unknown>
  useDatabase(p: { databasename: string }): Promise<unknown>
  set(p: { key: string; value: string }): Promise<{ id: number }>
  get(p: { key: string }): Promise<{ value: string }>
  scan(p: { prefix?: string; seekkey?: string; limit?: number }): Promise<{ entriesList: { tx: number; key: string; value: string }[] }>
  txScan(p: { initialtx: number; limit: number; desc?: boolean }): Promise<{ txsList: LedgerTx[] }>
  currentState(): Promise<{ txid: number; txhash: Uint8Array | string }>
  health(): Promise<{ status: boolean }>
  logout(): Promise<unknown>
}
type ClientCtor = new (cfg: { host: string; port: number; rootPath: string }) => Client

const Immudb = ((ImmudbModule as unknown as { default?: ClientCtor }).default ?? ImmudbModule) as unknown as ClientCtor

const PAGE = 200
const sha = (...parts: Buffer[]): Buffer => createHash('sha256').update(Buffer.concat(parts)).digest()
const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(n))
  return b
}
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}
const b64 = (s: string): Buffer => Buffer.from(s, 'base64')

/**
 * Accumulated linear hash of a transaction (immudb transaction format v1). The maintained Node
 * client cannot verify proofs from a current server, so the ledger recomputes the chain itself.
 */
function alh(m: TxMetadata): Buffer {
  const inner = sha(u64(m.ts), u16(1), u16(0), u32(m.nentries), b64(m.eh), u64(m.bltxid), b64(m.blroot))
  return sha(u64(m.id), b64(m.prevalh), inner)
}

/** Merkle root of a one-entry transaction: sha256(0x00 || sha256(0x0000 || len(key) || key || hvalue)). */
function singleEntryRoot(key: Buffer, hvalue: Buffer): Buffer {
  const digest = sha(u16(0), u16(key.length), key, hvalue)
  return sha(Buffer.from([0]), digest)
}

export function openLedger(config: ImmudbConfig & { lazy?: boolean }): Promise<Ledger> {
  let client: Client | undefined
  const statePath = join(tmpdir(), `mice-immudb-${process.pid}-${Math.random().toString(36).slice(2)}.json`)
  let pinned: { seq: number; alh: string } | undefined

  async function connect(): Promise<Client> {
    const c = new Immudb({ host: config.host, port: config.port, rootPath: statePath })
    await c.login({ user: config.user, password: config.password })
    const { databasesList } = await c.listDatabases()
    if (!databasesList.some((d) => d.databasename === config.database)) {
      // A concurrent starter may win the race; that is fine.
      await c.createDatabase({ databasename: config.database }).catch(() => undefined)
    }
    await c.useDatabase({ databasename: config.database })
    return c
  }

  // A stale session or dropped connection gets one fresh login before the error reaches the caller.
  async function run<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    try {
      client ??= await connect()
      return await fn(client)
    } catch {
      client = undefined
      client = await connect()
      return fn(client)
    }
  }

  const keyFor = (id: string): string => `${config.prefix}${id}`

  async function readAll(): Promise<LedgerRecord[]> {
    return run(async (c) => {
      const out: LedgerRecord[] = []
      let seek: string | undefined
      for (;;) {
        const res = await c.scan({ prefix: config.prefix, limit: PAGE, ...(seek ? { seekkey: seek } : {}) })
        const page = res.entriesList.filter((e) => e.key !== seek)
        for (const e of page) out.push({ seq: e.tx, key: e.key, value: e.value })
        if (page.length === 0 || res.entriesList.length < PAGE) break
        seek = page[page.length - 1]!.key
      }
      return out.sort((a, b) => a.seq - b.seq)
    })
  }

  async function verify(opts: VerifyOptions = {}): Promise<LedgerVerification> {
    const verifiedAt = new Date().toISOString()
    const fail = (seq: number, reason: string, events: number): LedgerVerification => ({ ok: false, events, verifiedAt, firstBreak: { seq, reason } })
    try {
      return await run(async (c) => {
        const state = await c.currentState()
        const head = state.txid
        if (head === 0) return { ok: true, events: 0, head: 0, verifiedAt }
        const values = new Map<number, LedgerRecord>()
        for (const r of await readAll()) values.set(r.seq, opts.tamper ? opts.tamper(r) : r)
        const from = Math.max(1, opts.window ? head - opts.window + 1 : 1)
        let prev: Buffer | undefined
        let seen = 0
        let index = 0
        let last: Buffer | undefined
        for (let next = from; next <= head; ) {
          const res = await c.txScan({ initialtx: next, limit: PAGE, desc: false })
          if (res.txsList.length === 0) return fail(next, 'transaction missing from the chain', seen)
          for (const raw of res.txsList) {
            // txScan can return txs committed after we pinned `head`; ignore them so
            // concurrent writers under other prefixes cannot fail this verification.
            if (raw.metadata.id > head) {
              next = head + 1
              break
            }
            const tx = opts.tamperTx ? opts.tamperTx(raw, index) : raw
            index++
            const m = tx.metadata
            if (prev && !prev.equals(b64(m.prevalh))) return fail(m.id, 'chain link broken: previous hash does not match', seen)
            const own = values.get(m.id)
            if (own) {
              const entry = tx.entriesList[0]
              if (tx.entriesList.length !== 1 || !entry) return fail(m.id, 'record transaction has an unexpected number of entries', seen)
              const hvalue = b64(entry.hvalue)
              if (!sha(Buffer.from([0]), Buffer.from(own.value)).equals(hvalue)) return fail(m.id, 'record value does not match its stored hash', seen)
              if (!singleEntryRoot(b64(entry.key), hvalue).equals(b64(m.eh))) return fail(m.id, 'record does not match its transaction root', seen)
              seen++
            }
            prev = alh(m)
            last = prev
            if (pinned && pinned.seq === m.id && pinned.alh !== prev.toString('base64')) {
              return fail(m.id, 'history changed since the last verification', seen)
            }
            next = m.id + 1
          }
        }
        const reported = typeof state.txhash === 'string' ? b64(state.txhash) : Buffer.from(state.txhash)
        if (!last || !last.equals(reported)) return fail(head, 'chain head does not match the server state', seen)
        pinned = { seq: head, alh: last.toString('base64') }
        return { ok: true, events: seen, head, verifiedAt }
      })
    } catch (err) {
      return fail(0, `audit ledger unreachable: ${String((err as Error)?.message ?? err)}`, 0)
    }
  }

  async function readAfter(seq: number, limit = 100): Promise<{ records: LedgerRecord[]; scannedTo: number }> {
    return run(async (c) => {
      const head = (await c.currentState()).txid
      if (head <= seq) return { records: [], scannedTo: seq }
      const res = await c.txScan({ initialtx: seq + 1, limit, desc: false })
      const records: LedgerRecord[] = []
      let scannedTo = seq
      for (const tx of res.txsList) {
        scannedTo = tx.metadata.id
        const entry = tx.entriesList[0]
        if (!entry || tx.entriesList.length !== 1) continue
        // Keys in the transaction log carry a one-byte prefix marker ahead of the user key.
        const key = b64(entry.key).subarray(1).toString()
        if (!key.startsWith(config.prefix)) continue
        const { value } = await c.get({ key })
        records.push({ seq: tx.metadata.id, key, value })
      }
      return { records, scannedTo }
    })
  }

  async function prove(id: string, opts: { tamper?: (record: LedgerRecord) => LedgerRecord } = {}): Promise<LedgerProof | undefined> {
    const key = keyFor(id)
    const found = (await readAll()).find((r) => r.key === key)
    if (!found) return undefined
    const own = opts.tamper ? opts.tamper(found) : found
    return run(async (c) => {
      const tx = (await c.txScan({ initialtx: found.seq, limit: 1, desc: false })).txsList[0]
      const entry = tx?.entriesList[0]
      if (!tx || tx.metadata.id !== found.seq || tx.entriesList.length !== 1 || !entry) {
        return { seq: found.seq, valid: false, transactionHash: '', previousTransactionHash: '', entryRoot: '' }
      }
      const hvalue = b64(entry.hvalue)
      const valid =
        sha(Buffer.from([0]), Buffer.from(own.value)).equals(hvalue) &&
        singleEntryRoot(b64(entry.key), hvalue).equals(b64(tx.metadata.eh))
      return {
        seq: found.seq,
        valid,
        transactionHash: alh(tx.metadata).toString('hex'),
        previousTransactionHash: b64(tx.metadata.prevalh).toString('hex'),
        entryRoot: b64(tx.metadata.eh).toString('hex'),
      }
    })
  }

  const ledger: Ledger = {
    async append(id, value) {
      const tx = await run((c) => c.set({ key: keyFor(id), value }))
      return tx.id
    },
    readAll,
    readAfter,
    verify,
    prove,
    async health() {
      try {
        await run((c) => c.health())
        return { ok: true }
      } catch (err) {
        return { ok: false, detail: String((err as Error)?.message ?? err) }
      }
    },
    async close() {
      // Drop the client only. immudb logout is user-scoped and would invalidate
      // concurrent clients (other test processes) that share the same credentials.
      client = undefined
    },
  }
  return Promise.resolve(ledger)
}
