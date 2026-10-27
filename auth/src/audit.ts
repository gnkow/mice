import { randomBytes } from 'node:crypto'
import { currentClock, systemClock, type Clock } from './clock.js'
import { env } from './env.js'
import { auditActionLabel } from './auditLabels.js'
import { immudbConfig, openLedger, type Ledger, type LedgerVerification } from './auditLedger.js'
import { getServicePrincipal, kindOf, type SessionUser } from './authentication/index.js'

export type AuditVia = 'session' | 'pat'

export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

/** `intent` is written before a mutation runs, `outcome` after. Other events carry no phase. */
export type AuditPhase = 'intent' | 'outcome'

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  via: AuditVia | 'system'
  phase?: AuditPhase
  /** On an outcome event: the id of the intent event it completes. */
  intent_id?: string
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
  /** Hashed IP (SHA-256(IP + daily_salt)) for anomaly detection while preserving privacy (U8). */
  hashed_ip?: string
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
   * Lists show one row per mutation: an intent that has an outcome is hidden (the outcome carries
   * `intent_id`). An intent without an outcome stays visible, as it means the mutation may have
   * started and never completed. Set to see every intent.
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

export class AuditStoreError extends Error {}

let ledger: Promise<Ledger> | undefined

function ledgerOrOpen(): Promise<Ledger> {
  ledger ??= openLedger(immudbConfig())
  return ledger
}

/** Swaps the ledger (tests wrap the real one to inject faults). */
export function useAuditLedger(next: Ledger): void {
  ledger = Promise.resolve(next)
}

export type AuditVerification = LedgerVerification
let lastVerification: AuditVerification | null = null

let acknowledged: { seq: number; reason: string } | null = null

/**
 * True while the last verification failed and the operator has not acknowledged that same
 * break. Dataset mutations are refused meanwhile. A different or later break blocks again.
 */
export function auditChainBlocked(): boolean {
  const v = lastVerification
  if (!v || v.ok) return false
  return !(acknowledged && acknowledged.seq === v.firstBreak.seq && acknowledged.reason === v.firstBreak.reason)
}

/** Re-verifies and acknowledges the current break; null when the trail is intact. Held in memory, so a restart asks again. */
export async function acknowledgeAuditBreak(): Promise<{ seq: number; reason: string } | null> {
  const v = await verifyAudit()
  if (v.ok) return null
  acknowledged = { seq: v.firstBreak.seq, reason: v.firstBreak.reason }
  return acknowledged
}

/** Evidence bundle for the events matching `query`, with a fresh verification of the ledger; see GLOSSARY "audit bundle". */
export async function buildAuditExportBundle(
  query: AuditQuery,
  exportedBy: AuditActor,
  filters: Record<string, unknown>,
): Promise<{ ok: true; bundle: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const { events: found, truncated } = await queryAuditForExport(query)
    const verification = await verifyAudit()
    return {
      ok: true,
      bundle: {
        format: 'mice-audit-bundle/2',
        exported_at: new Date(currentClock.now()).toISOString(),
        exported_by: exportedBy,
        range: filters,
        truncated,
        events: [...found].reverse(),
        verification,
      },
    }
  } catch (err) {
    return { ok: false, error: `Audit store unavailable: ${String((err as Error)?.message ?? err)}` }
  }
}

/** Walks the ledger's proofs and remembers the result for readiness. */
export async function verifyAudit(): Promise<AuditVerification> {
  let result: AuditVerification
  try {
    result = await (await ledgerOrOpen()).verify()
  } catch (err) {
    result = { ok: false, events: 0, verifiedAt: new Date(currentClock.now()).toISOString(), firstBreak: { seq: 0, reason: `audit store unreadable: ${String(err)}` } }
  }
  lastVerification = result
  return result
}

let lastAppendError: string | null = null

export type AuditReadiness = {
  ok: boolean
  store: 'ok' | 'error'
  chain: 'ok' | 'broken' | 'acknowledged' | 'unverified'
  events?: number
  verifiedAt?: string
  firstBreak?: { seq: number; reason: string }
  detail?: string
}

/** Cheap: pings the ledger and reads the last verification; never walks the proofs. */
export async function auditReadiness(): Promise<AuditReadiness> {
  let store: 'ok' | 'error' = lastAppendError ? 'error' : 'ok'
  let detail = lastAppendError ?? undefined
  const health = await (await ledgerOrOpen()).health().catch((err: unknown) => ({ ok: false as const, detail: String(err) }))
  if (!health.ok) {
    store = 'error'
    detail = health.detail
  } else {
    // The ledger answers again; do not stay red on a stale append error.
    store = 'ok'
    detail = undefined
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

/** Boot check: connects to the ledger (creating its database on first use) and verifies it. */
export async function initAudit(): Promise<AuditVerification> {
  await ledgerOrOpen()
  return verifyAudit()
}

/**
 * Re-verifies when `intervalMs` has elapsed on the clock. `tick()` returns whether it verified;
 * with `poll` (default) a timer calls it every `min(intervalMs, 60s)`.
 */
export function startAuditVerifySchedule(
  opts: { clock?: Clock; intervalMs?: number; poll?: boolean } = {},
): { tick(): Promise<boolean>; stop(): void } {
  const clock = opts.clock ?? systemClock
  const intervalMs = opts.intervalMs ?? env.auditVerifyIntervalSec * 1000
  let last = clock.now()
  const tick = async (): Promise<boolean> => {
    if (clock.now() - last < intervalMs) return false
    last = clock.now()
    const v = await verifyAudit()
    if (!v.ok) console.error('[mice-auth] audit verification FAILED', v.firstBreak)
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(() => void tick(), Math.min(intervalMs, 60_000))
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

async function serviceActorFields(actor: AuditActor): Promise<Pick<AuditEvent, 'actorKind' | 'owner'>> {
  if (kindOf(actor) !== 'service') return {}
  const o = (await getServicePrincipal(actor.sub))?.owner
  return { actorKind: 'service', ...(o ? { owner: { sub: o.sub, iss: o.iss, email: o.email, name: o.name } } : {}) }
}

export type AuditInput = Omit<AuditEvent, 'id' | 'ts' | 'phase' | 'intent_id' | 'via'> & {
  id?: string
  ts?: string
  via: AuditVia | 'system'
}

async function buildEvent(partial: AuditInput, extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object = {}): Promise<AuditEvent> {
  return {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    actor: partial.actor,
    via: partial.via,
    method: partial.method,
    path: partial.path,
    status: partial.status,
    action: partial.action,
    ...(await serviceActorFields(partial.actor)),
    ...(partial.namespace ? { namespace: partial.namespace } : {}),
    ...(partial.repo ? { repo: partial.repo } : {}),
    ...(partial.message ? { message: partial.message } : {}),
    ...(partial.reason ? { reason: partial.reason, reason_source: partial.reason_source } : {}),
    ...(partial.dataset ? { dataset: partial.dataset } : {}),
    ...(partial.unverified ? { unverified: true as const } : {}),
    ...(partial.detail && Object.keys(partial.detail).length
      ? { detail: partial.detail }
      : {}),
    ...(partial.hashed_ip ? { hashed_ip: partial.hashed_ip } : {}),
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

async function appendStored(partial: AuditInput, extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object): Promise<AuditEvent> {
  try {
    const event = await buildEvent(partial, extra)
    await (await ledgerOrOpen()).append(event.id, JSON.stringify(event))
    lastAppendError = null
    return event
  } catch (err) {
    lastAppendError = String(err)
    console.error('[mice-auth] audit append failed', err)
    throw err
  }
}

/** A single event with no intent/outcome pairing. Best-effort: returns null when the store fails. */
export async function appendAudit(partial: AuditInput): Promise<AuditEvent | null> {
  try {
    const event = await appendStored(partial, {})
    observe(event)
    return event
  } catch {
    return null
  }
}

/** Written before a mutation runs. Throws when it cannot be stored; the caller must then refuse the mutation. */
export function appendIntent(partial: AuditInput): Promise<AuditEvent> {
  return appendStored(partial, { phase: 'intent' })
}

/** Written after a mutation ran, linked to its intent. Best-effort: the mutation already happened. */
export async function appendOutcome(intentId: string, partial: AuditInput): Promise<AuditEvent | null> {
  try {
    const event = await appendStored(partial, { phase: 'outcome', intent_id: intentId })
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
export function appendOutcomeFor(request: object, partial: AuditInput): Promise<AuditEvent | null> {
  const tracked = intents.get(request)
  if (!tracked) return appendAudit(partial)
  tracked.outcomes += 1
  return appendOutcome(tracked.id, { ...tracked.reason, ...partial })
}

export function trackedIntent(request: object): { id: string; outcomes: number } | undefined {
  return intents.get(request)
}

/** Events written after ledger position `seq`; `scannedTo` is the position to resume from. */
export async function readAuditAfter(seq: number, limit?: number): Promise<{ events: AuditEvent[]; scannedTo: number }> {
  const { records, scannedTo } = await (await ledgerOrOpen()).readAfter(seq, limit)
  const events: AuditEvent[] = []
  for (const record of records) {
    try {
      events.push(JSON.parse(record.value) as AuditEvent)
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return { events, scannedTo }
}

async function readAllEvents(): Promise<AuditEvent[]> {
  const out: AuditEvent[] = []
  for (const record of await (await ledgerOrOpen()).readAll()) {
    try {
      out.push(JSON.parse(record.value) as AuditEvent)
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

async function filterEvents(q: AuditQuery): Promise<AuditEvent[]> {
  let events = await readAllEvents()

  if (!q.includeChain) {
    const resolved = new Set(events.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])))
    events = events.filter((e) => !(e.phase === 'intent' && resolved.has(e.id)))
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

export async function queryAudit(q: AuditQuery): Promise<{
  events: AuditEvent[]
  nextCursor: string | null
}> {
  const limit = Math.min(
    Math.max(1, q.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  let events = await filterEvents(q)

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
export async function queryAuditForExport(q: AuditQuery): Promise<{
  events: AuditEvent[]
  truncated: boolean
}> {
  const events = await filterEvents({ ...q, cursor: undefined, limit: undefined })
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
export async function auditFacets(scope: Pick<AuditQuery, 'allowedNamespaces' | 'namespace'>): Promise<{
  sessions: AuditResource[]
  workspaces: AuditResource[]
  jobs: AuditResource[]
  observedActions: string[]
}> {
  const events = await filterEvents(scope)
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
