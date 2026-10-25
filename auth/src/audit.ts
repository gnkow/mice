import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { AuditStoreError, createAuditChain, type ChainBreak, type ChainLinks, type Verification } from './auditChain.js'
import { currentClock, systemClock, type Clock } from './clock.js'
import { createAppendOnlyLog } from './stores.js'
import { loadSigningKey, signingKeyFromPem, signRecord, verifyRecord, type AuditSigningKey, type AuditSigningSource } from './auditSigning.js'
import { auditActionLabel } from './auditLabels.js'
import { kindOf } from './principal.js'
import { getServicePrincipal } from './servicePrincipals.js'
import type { SessionUser } from './session.js'

export type AuditVia = 'session' | 'pat'

export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

/** `intent` is written before a mutation runs, `outcome` after; `genesis` opens the chain. Other events carry no phase. */
export type AuditPhase = 'genesis' | 'intent' | 'outcome'

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  via: AuditVia | 'system'
  phase?: AuditPhase
  /** On an outcome event: the id of the intent event it completes. */
  intent_id?: string
  prev_hash: string
  hash: string
  method: string
  path: string
  status: number
  action: string
  namespace?: string
  repo?: string
  message?: string
  /** Why the change was made (mandatory for dataset and admin mutations); `message` stays the commit message. */
  reason?: string
  reason_source?: 'explicit' | 'commit-message' | 'registered'
  /** Dataset commit ids before and after a dataset mutation. */
  dataset?: { base?: string; head?: string }
  /** The mutation succeeded but its resulting dataset version could not be determined. */
  unverified?: true
  detail?: Record<string, unknown>
  /** Set when the actor is a service principal; `owner` is its accountable human. */
  actorKind?: 'service'
  owner?: AuditActor
}

export type AuditQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  since?: string
  until?: string
  limit?: number
  /** Exclusive: return events older than this id (reverse chronological). */
  cursor?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: AuditVia
  /** AuthZ scope: only events in these namespaces (applied before paging). */
  allowedNamespaces?: string[]
  /**
   * Lists show one row per mutation: the genesis event and any intent that has an outcome are
   * hidden (the outcome carries `intent_id`). An intent without an outcome stays visible, as it
   * means the mutation may have started and never completed. Set to see every chain event.
   */
  includeChain?: boolean
}

export type AuditResource = {
  id: string
  count: number
  lastTs: string
  namespace?: string
  repo?: string
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
let auditObserver: ((event: AuditEvent) => void) | undefined

export function setAuditObserver(observer: (event: AuditEvent) => void): void {
  auditObserver = observer
}

function storePath(): string {
  return join(env.dataDir, 'audit.jsonl')
}

const SYSTEM_ACTOR: AuditActor = { sub: 'mice-audit', iss: 'mice', email: '', name: 'Mice audit' }

const chain = createAuditChain<Omit<AuditEvent, keyof ChainLinks>>(
  createAppendOnlyLog<Omit<AuditEvent, keyof ChainLinks> & ChainLinks>(storePath),
  () => ({
    id: randomBytes(8).toString('hex'),
    ts: new Date().toISOString(),
    actor: SYSTEM_ACTOR,
    via: 'system',
    method: 'SYSTEM',
    path: '/audit/genesis',
    status: 200,
    action: 'audit.genesis',
    phase: 'genesis',
  }),
)
const events = createAppendOnlyLog<AuditEvent>(storePath)

export { AuditStoreError }

export type AuditVerification = Verification & { verifiedAt: string; checkpoints?: number }
let lastVerification: AuditVerification | null = null

export type AuditCheckpoint = {
  id: string
  ts: string
  event_count: number
  last_hash: string
  key_id: string
  trigger: 'daily' | 'shutdown' | 'manual'
  signature: string
}
type KeyRecord = { key_id: string; public_key_pem: string; registered_at: string }

const checkpointLog = createAppendOnlyLog<AuditCheckpoint>(() => join(env.dataDir, 'audit-checkpoints.jsonl'))
/** Public keys of every key id ever used; old ones stay so past checkpoints remain verifiable. */
const keyLog = createAppendOnlyLog<KeyRecord>(() => join(env.dataDir, 'audit-keys.jsonl'))
let signingKey: AuditSigningKey | null = null

const parseLines = <T>(lines: string[]): (T | undefined)[] =>
  lines.map((l) => {
    try {
      return JSON.parse(l) as T
    } catch {
      return undefined
    }
  })

export function auditCheckpoints(): AuditCheckpoint[] {
  return parseLines<AuditCheckpoint>(checkpointLog.readLines()).filter((c): c is AuditCheckpoint => !!c)
}

export function auditPublicKeys(): KeyRecord[] {
  return parseLines<KeyRecord>(keyLog.readLines()).filter((k): k is KeyRecord => !!k)
}

/** Activates a signing key and records its public half; a key id can never name two different keys. */
export function useAuditSigningKey(key: { keyId: string; privateKeyPem: string }): AuditSigningKey {
  return activateSigningKey(signingKeyFromPem(key.privateKeyPem, key.keyId))
}

/** Boot: loads the key from the environment or a secret mount (throws when missing) and registers it. */
export function initAuditSigning(
  src: Partial<AuditSigningSource> = {
    key: env.auditSigningKey,
    keyFile: env.auditSigningKeyFile,
    keyId: env.auditSigningKeyId,
  },
): { keyId: string; publicKeyPem: string } {
  const loaded = loadSigningKey({ dataDir: env.dataDir, ...src })
  const registered = activateSigningKey(loaded)
  return { keyId: registered.keyId, publicKeyPem: registered.publicKeyPem }
}

function activateSigningKey(loaded: AuditSigningKey): AuditSigningKey {
  const known = auditPublicKeys().find((k) => k.key_id === loaded.keyId)
  if (known && known.public_key_pem.trim() !== loaded.publicKeyPem.trim()) {
    throw new Error(`Audit signing key id "${loaded.keyId}" is already registered with a different public key; use a new key id when rotating`)
  }
  if (!known) {
    keyLog.append({ key_id: loaded.keyId, public_key_pem: loaded.publicKeyPem, registered_at: new Date(currentClock.now()).toISOString() })
  }
  signingKey = loaded
  return loaded
}

export function currentSigningKey(): AuditSigningKey | null {
  return signingKey
}

type CheckpointBody = Omit<AuditCheckpoint, 'signature'>

const DAY_MS = 24 * 3600_000

/**
 * Signs the chain's current end (last hash, event count, key id) and stores it apart from the
 * chain, then notes it in the chain. Refuses a chain that fails verification, so a broken trail
 * is never signed. Returns null when nothing happened since the previous checkpoint.
 */
export function writeCheckpoint(trigger: AuditCheckpoint['trigger']): AuditCheckpoint | null {
  if (!signingKey) throw new AuditStoreError('no audit signing key is configured')
  const v = verifyAudit()
  if (!v.ok) throw new AuditStoreError(`audit chain verification failed; refusing to sign a checkpoint (${v.firstBreak.reason})`)
  const last = auditCheckpoints().at(-1)
  // Only the previous checkpoint's own marker event has been added since.
  if (last && v.events <= last.event_count + 1) return null
  const body: CheckpointBody = {
    id: randomBytes(8).toString('hex'),
    ts: new Date(currentClock.now()).toISOString(),
    event_count: v.events,
    last_hash: v.lastHash,
    key_id: signingKey.keyId,
    trigger,
  }
  const checkpoint: AuditCheckpoint = { ...body, signature: signRecord(signingKey, body) }
  checkpointLog.append(checkpoint)
  appendAudit({
    actor: SYSTEM_ACTOR,
    via: 'system',
    method: 'SYSTEM',
    path: '/audit/checkpoint',
    status: 200,
    action: 'audit.checkpoint',
    detail: { checkpoint_id: checkpoint.id, key_id: checkpoint.key_id, event_count: checkpoint.event_count, trigger },
  })
  verifyAudit()
  return checkpoint
}

/** Writes a checkpoint every 24h on the clock. `tick()` returns whether the interval elapsed. */
export function startAuditCheckpointSchedule(
  opts: { clock?: Clock; intervalMs?: number; poll?: boolean } = {},
): { tick(): boolean; stop(): void } {
  const clock = opts.clock ?? systemClock
  const intervalMs = opts.intervalMs ?? DAY_MS
  let last = clock.now()
  const tick = (): boolean => {
    if (clock.now() - last < intervalMs) return false
    last = clock.now()
    try {
      writeCheckpoint('daily')
    } catch (err) {
      console.error('[mice-auth] audit checkpoint failed', err)
    }
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(tick, Math.min(intervalMs, 60_000))
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}

let acknowledged: { index: number; reason: string } | null = null

/**
 * True while the last verification failed and the operator has not acknowledged that same
 * break. Dataset mutations are refused meanwhile. A different or later break blocks again.
 */
/** Signed evidence bundle for the events matching `query`; see GLOSSARY "audit bundle". */
export function buildAuditExportBundle(
  query: AuditQuery,
  exportedBy: AuditActor,
  filters: Record<string, unknown>,
): { ok: true; bundle: Record<string, unknown> } | { ok: false; error: string } {
  if (!signingKey) return { ok: false, error: 'No audit signing key is configured; the bundle cannot be signed' }
  const { events: found, truncated } = queryAuditForExport(query)
  const verification = verifyAudit()
  const checkpoints = auditCheckpoints()
  const used = new Set([...checkpoints.map((c) => c.key_id), signingKey.keyId])
  const body = {
    format: 'mice-audit-bundle/1',
    exported_at: new Date(currentClock.now()).toISOString(),
    exported_by: exportedBy,
    range: filters,
    truncated,
    events: [...found].reverse(),
    checkpoints,
    verification,
    public_keys: auditPublicKeys()
      .filter((k) => used.has(k.key_id))
      .map((k) => ({ key_id: k.key_id, public_key_pem: k.public_key_pem })),
  }
  return { ok: true, bundle: { ...body, signing: { key_id: signingKey.keyId, algorithm: 'Ed25519', signature: signRecord(signingKey, body) } } }
}

export function auditChainBlocked(): boolean {
  const v = lastVerification
  if (!v || v.ok) return false
  return !(acknowledged && acknowledged.index === v.firstBreak.index && acknowledged.reason === v.firstBreak.reason)
}

/** Re-verifies and acknowledges the current break; false when the chain is intact. Held in memory, so a restart asks again. */
export function acknowledgeAuditBreak(): { index: number; reason: string } | null {
  const v = verifyAudit()
  if (v.ok) return null
  acknowledged = { index: v.firstBreak.index, reason: v.firstBreak.reason }
  return acknowledged
}


/** Checks every checkpoint against the chain and the retained public keys; returns the first problem. */
function verifyCheckpoints(hashes: string[], rows: (AuditEvent | undefined)[]): { count: number } | { index: number; reason: string } {
  const keys = new Map(auditPublicKeys().map((k) => [k.key_id, k.public_key_pem]))
  const lines = checkpointLog.readLines()
  const seen = new Set<string>()
  let lastCount = 0
  for (let i = 0; i < lines.length; i++) {
    let cp: AuditCheckpoint
    try {
      cp = JSON.parse(lines[i]!) as AuditCheckpoint
    } catch {
      return { index: Math.max(0, hashes.length - 1), reason: `checkpoint ${i} cannot be parsed` }
    }
    const { signature, ...body } = cp
    const pem = keys.get(cp.key_id)
    const at = Math.max(0, Math.min(hashes.length, cp.event_count) - 1)
    if (!pem) return { index: at, reason: `checkpoint ${cp.id} names unknown key id "${cp.key_id}"` }
    if (typeof signature !== 'string' || !verifyRecord(pem, body, signature)) {
      return { index: at, reason: `checkpoint ${cp.id} signature is invalid (checkpoint altered)` }
    }
    if (cp.event_count < lastCount) return { index: at, reason: `checkpoint ${cp.id} event count goes backwards` }
    lastCount = cp.event_count
    if (cp.event_count > hashes.length) {
      return {
        index: hashes.length,
        reason: `checkpoint ${cp.id} covers ${cp.event_count} events but the chain has ${hashes.length} (trailing events dropped)`,
      }
    }
    if (hashes[cp.event_count - 1] !== cp.last_hash) {
      return { index: cp.event_count - 1, reason: `checkpoint ${cp.id} last_hash does not match the chain (history rewritten)` }
    }
    seen.add(cp.id)
  }
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]
    const id = e?.action === 'audit.checkpoint' ? e.detail?.checkpoint_id : undefined
    if (typeof id === 'string' && !seen.has(id)) {
      return { index: i, reason: `checkpoint ${id} is recorded in the chain but missing from the checkpoint store` }
    }
  }
  return { count: lines.length }
}

/** Walks the whole chain and its checkpoints, and remembers the result for readiness. */
export function verifyAudit(): AuditVerification {
  let result: Verification & { checkpoints?: number }
  try {
    result = chain.verify()
    if (result.ok) {
      const rows = parseLines<AuditEvent>(events.readLines())
      const cp = verifyCheckpoints(chain.hashes(), rows)
      result =
        'count' in cp
          ? { ...result, checkpoints: cp.count }
          : { ok: false, events: result.events, firstBreak: { index: cp.index, reason: cp.reason } }
    }
  } catch (err) {
    result = { ok: false, events: 0, firstBreak: { index: 0, reason: `audit store unreadable: ${String(err)}` } }
  }
  lastVerification = { ...result, verifiedAt: new Date(currentClock.now()).toISOString() }
  return lastVerification
}

let lastAppendError: string | null = null

export type AuditReadiness = {
  ok: boolean
  store: 'ok' | 'error'
  chain: 'ok' | 'broken' | 'acknowledged' | 'unverified'
  events?: number
  verifiedAt?: string
  firstBreak?: ChainBreak
  detail?: string
}

/** Cheap: reads the last verification and the last append outcome; never walks the chain. */
export function auditReadiness(): AuditReadiness {
  let store: 'ok' | 'error' = lastAppendError ? 'error' : 'ok'
  let detail = lastAppendError ?? undefined
  try {
    events.readLines()
  } catch (err) {
    store = 'error'
    detail = String(err)
  }
  const v = lastVerification
  const chainState = !v ? 'unverified' : v.ok ? 'ok' : auditChainBlocked() ? 'broken' : 'acknowledged'
  return {
    ok: store === 'ok' && chainState !== 'broken',
    store,
    chain: chainState,
    ...(v ? { events: v.events, verifiedAt: v.verifiedAt } : {}),
    ...(v && !v.ok ? { firstBreak: v.firstBreak } : {}),
    ...(detail ? { detail } : {}),
  }
}

/**
 * Boot check: refuses a non-empty unchained audit.jsonl, writes the genesis event on an empty
 * one, then verifies the chain.
 */
export function initAudit(): AuditVerification {
  chain.ensureGenesis()
  return verifyAudit()
}

/**
 * Re-verifies when `intervalMs` has elapsed on the clock. `tick()` returns whether it verified;
 * with `poll` (default) a timer calls it every `min(intervalMs, 60s)`.
 */
export function startAuditVerifySchedule(
  opts: { clock?: Clock; intervalMs?: number; poll?: boolean } = {},
): { tick(): boolean; stop(): void } {
  const clock = opts.clock ?? systemClock
  const intervalMs = opts.intervalMs ?? env.auditVerifyIntervalSec * 1000
  let last = clock.now()
  const tick = (): boolean => {
    if (clock.now() - last < intervalMs) return false
    last = clock.now()
    const v = verifyAudit()
    if (!v.ok) console.error('[mice-auth] audit chain verification FAILED', v.firstBreak)
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(tick, Math.min(intervalMs, 60_000))
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}

export function actorFromUser(user: SessionUser): AuditActor {
  return {
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
  }
}


export function extractMessageFromJson(
  body: Record<string, unknown>,
): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = body[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractMessageFromForm(form: FormData): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = form.get(key)
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractRepoCreateFromJson(
  body: Record<string, unknown>,
): { namespace?: string; repo?: string } {
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined
  const repo = typeof body.name === 'string' ? body.name : undefined
  return { namespace, repo }
}

function serviceActorFields(actor: AuditActor): Pick<AuditEvent, 'actorKind' | 'owner'> {
  if (kindOf(actor) !== 'service') return {}
  const o = getServicePrincipal(actor.sub)?.owner
  return { actorKind: 'service', ...(o ? { owner: { sub: o.sub, iss: o.iss, email: o.email, name: o.name } } : {}) }
}

export type AuditInput = Omit<AuditEvent, 'id' | 'ts' | 'prev_hash' | 'hash' | 'phase' | 'intent_id' | 'via'> & {
  id?: string
  ts?: string
  via: AuditVia | 'system'
}

function buildEvent(partial: AuditInput, extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object = {}) {
  return {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    actor: partial.actor,
    via: partial.via,
    method: partial.method,
    path: partial.path,
    status: partial.status,
    action: partial.action,
    ...serviceActorFields(partial.actor),
    ...(partial.namespace ? { namespace: partial.namespace } : {}),
    ...(partial.repo ? { repo: partial.repo } : {}),
    ...(partial.message ? { message: partial.message } : {}),
    ...(partial.reason ? { reason: partial.reason, reason_source: partial.reason_source } : {}),
    ...(partial.dataset ? { dataset: partial.dataset } : {}),
    ...(partial.unverified ? { unverified: true as const } : {}),
    ...(partial.detail && Object.keys(partial.detail).length
      ? { detail: partial.detail }
      : {}),
    ...extra,
  }
}

function observe(event: AuditEvent): void {
  if (!auditObserver) return
  try {
    auditObserver(event)
  } catch (error) {
    // The journal remains durable; the notification worker retries projection.
    console.error('[mice-auth] notification capture failed; replay required', error)
  }
}

function appendChained(partial: AuditInput, extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object): AuditEvent {
  try {
    const event = chain.append(buildEvent(partial, extra)) as AuditEvent
    lastAppendError = null
    return event
  } catch (err) {
    lastAppendError = String(err)
    console.error('[mice-auth] audit append failed', err)
    throw err
  }
}

/** A single event with no intent/outcome pairing. Best-effort: returns null when the store fails. */
export function appendAudit(partial: AuditInput): AuditEvent | null {
  try {
    const event = appendChained(partial, {})
    observe(event)
    return event
  } catch {
    return null
  }
}

/** Written before a mutation runs. Throws when it cannot be stored; the caller must then refuse the mutation. */
export function appendIntent(partial: AuditInput): AuditEvent {
  return appendChained(partial, { phase: 'intent' })
}

/** Written after a mutation ran, linked to its intent. Best-effort: the mutation already happened. */
export function appendOutcome(intentId: string, partial: AuditInput): AuditEvent | null {
  try {
    const event = appendChained(partial, { phase: 'outcome', intent_id: intentId })
    observe(event)
    return event
  } catch {
    return null
  }
}

const intents = new WeakMap<object, { id: string; outcomes: number; reason?: Pick<AuditEvent, 'reason' | 'reason_source'> }>()

/** Remembers the intent written for a request so native audit calls can link their outcome to it. */
export function trackIntent(request: object, intent: AuditEvent): void {
  intents.set(request, {
    id: intent.id,
    outcomes: 0,
    ...(intent.reason ? { reason: { reason: intent.reason, reason_source: intent.reason_source } } : {}),
  })
}

/** Appends an outcome for the request's tracked intent, or a plain event when it has none. */
export function appendOutcomeFor(request: object, partial: AuditInput): AuditEvent | null {
  const tracked = intents.get(request)
  if (!tracked) return appendAudit(partial)
  tracked.outcomes += 1
  return appendOutcome(tracked.id, { ...tracked.reason, ...partial })
}

export function trackedIntent(request: object): { id: string; outcomes: number } | undefined {
  return intents.get(request)
}

function readAllEvents(): AuditEvent[] {
  const out: AuditEvent[] = []
  for (const line of events.readLines()) {
    try {
      out.push(JSON.parse(line) as AuditEvent)
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return out
}

function detailStrings(
  detail: Record<string, unknown> | undefined,
  single: string,
  plural?: string,
): string[] {
  if (!detail) return []
  const out: string[] = []
  const one = detail[single]
  if (typeof one === 'string' && one) out.push(one)
  if (plural) {
    const many = detail[plural]
    if (Array.isArray(many)) {
      for (const v of many) if (typeof v === 'string' && v) out.push(v)
    }
  }
  return out
}

/** Session ids an event refers to. */
export function eventSessionIds(e: AuditEvent): string[] {
  return detailStrings(e.detail, 'session_id')
}

/** Job ids an event refers to (single or batch). */
export function eventJobIds(e: AuditEvent): string[] {
  return detailStrings(e.detail, 'job_id', 'job_ids')
}

/** Workspace ids an event refers to, including session mounts. */
export function eventWorkspaceIds(e: AuditEvent): string[] {
  const ids = detailStrings(e.detail, 'workspace_id')
  const mounts = e.detail?.mounts
  if (Array.isArray(mounts)) {
    for (const m of mounts) {
      const w = (m as { workspace_id?: unknown } | null)?.workspace_id
      if (typeof w === 'string' && w) ids.push(w)
    }
  }
  return ids
}

function filterEvents(q: AuditQuery): AuditEvent[] {
  let events = readAllEvents()

  if (!q.includeChain) {
    const resolved = new Set(events.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])))
    events = events.filter((e) => e.phase !== 'genesis' && !(e.phase === 'intent' && resolved.has(e.id)))
  }

  // Newest first
  events.reverse()

  if (q.allowedNamespaces) {
    const allowed = new Set(q.allowedNamespaces)
    events = events.filter((e) => e.namespace && allowed.has(e.namespace))
  }
  if (q.actor) {
    const a = q.actor.toLowerCase()
    events = events.filter(
      (e) =>
        e.actor.sub.toLowerCase().includes(a) ||
        e.actor.email.toLowerCase().includes(a) ||
        e.actor.name.toLowerCase().includes(a),
    )
  }
  if (q.namespace) {
    events = events.filter((e) => e.namespace === q.namespace)
  }
  if (q.repo) {
    events = events.filter((e) => e.repo === q.repo)
  }
  if (q.action) {
    events = events.filter(
      (e) => e.action === q.action || e.action.startsWith(`${q.action}.`),
    )
  }
  if (q.via) {
    events = events.filter((e) => e.via === q.via)
  }
  if (q.sessionId) {
    const id = q.sessionId
    events = events.filter((e) => eventSessionIds(e).includes(id))
  }
  if (q.workspaceId) {
    const id = q.workspaceId
    events = events.filter((e) => eventWorkspaceIds(e).includes(id))
  }
  if (q.jobId) {
    const id = q.jobId
    events = events.filter((e) => eventJobIds(e).includes(id))
  }
  if (q.since) {
    const since = q.since
    events = events.filter((e) => e.ts >= since)
  }
  if (q.until) {
    const until = q.until
    events = events.filter((e) => e.ts <= until)
  }
  return events
}

export function queryAudit(q: AuditQuery): {
  events: AuditEvent[]
  nextCursor: string | null
} {
  const limit = Math.min(
    Math.max(1, q.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  let events = filterEvents(q)

  if (q.cursor) {
    const idx = events.findIndex((e) => e.id === q.cursor)
    if (idx >= 0) events = events.slice(idx + 1)
  }

  const page = events.slice(0, limit)
  const nextCursor =
    page.length === limit && events.length > limit
      ? (page[page.length - 1]?.id ?? null)
      : null

  return { events: page, nextCursor }
}

export const EXPORT_MAX_ROWS = 50_000

/** All matching events (newest first) for export; ignores paging, capped at EXPORT_MAX_ROWS. */
export function queryAuditForExport(q: AuditQuery): {
  events: AuditEvent[]
  truncated: boolean
} {
  const events = filterEvents({ ...q, cursor: undefined, limit: undefined })
  return {
    events: events.slice(0, EXPORT_MAX_ROWS),
    truncated: events.length > EXPORT_MAX_ROWS,
  }
}

const FACET_CAP = 200

function collectResources(
  events: AuditEvent[],
  pick: (e: AuditEvent) => string[],
): AuditResource[] {
  const map = new Map<string, AuditResource>()
  // events are newest first, so the first sighting carries the latest timestamp
  for (const e of events) {
    for (const id of pick(e)) {
      const cur = map.get(id)
      if (cur) {
        cur.count += 1
        if (!cur.namespace && e.namespace) cur.namespace = e.namespace
        if (!cur.repo && e.repo) cur.repo = e.repo
      } else {
        map.set(id, {
          id,
          count: 1,
          lastTs: e.ts,
          ...(e.namespace ? { namespace: e.namespace } : {}),
          ...(e.repo ? { repo: e.repo } : {}),
        })
      }
    }
  }
  return [...map.values()].slice(0, FACET_CAP)
}

/** Distinct sessions / workspaces / jobs / actions seen in the (scoped) log. */
export function auditFacets(scope: Pick<AuditQuery, 'allowedNamespaces' | 'namespace'>): {
  sessions: AuditResource[]
  workspaces: AuditResource[]
  jobs: AuditResource[]
  observedActions: string[]
} {
  const events = filterEvents(scope)
  return {
    sessions: collectResources(events, eventSessionIds),
    workspaces: collectResources(events, eventWorkspaceIds),
    jobs: collectResources(events, eventJobIds),
    observedActions: [...new Set(events.map((e) => e.action))].sort(),
  }
}

export const AUDIT_CSV_COLUMNS = [
  'timestamp',
  'actor_name',
  'actor_email',
  'actor_sub',
  'actor_issuer',
  'via',
  'action',
  'action_label',
  'namespace',
  'repo',
  'session_id',
  'workspace_id',
  'job_id',
  'method',
  'path',
  'status',
  'message',
  'reason',
  'reason_source',
  'dataset_base',
  'dataset_head',
  'unverified',
  'detail',
  'event_id',
  'intent_id',
  'phase',
] as const

/** RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would treat as a formula. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function auditEventsToCsv(events: AuditEvent[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(',')]
  for (const e of events) {
    lines.push(
      [
        e.ts,
        e.actor.name,
        e.actor.email,
        e.actor.sub,
        e.actor.iss,
        e.via,
        e.action,
        auditActionLabel(e.action),
        e.namespace,
        e.repo,
        eventSessionIds(e).join(';'),
        eventWorkspaceIds(e).join(';'),
        eventJobIds(e).join(';'),
        e.method,
        e.path,
        e.phase === 'intent' ? '' : e.status,
        e.message,
        e.reason,
        e.reason_source,
        e.dataset?.base,
        e.dataset?.head,
        e.unverified ? 'true' : '',
        e.detail ? JSON.stringify(e.detail) : '',
        e.id,
        e.intent_id,
        e.phase,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
