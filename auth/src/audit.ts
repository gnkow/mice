import { randomBytes } from 'node:crypto'
import { auditChainGate, type AuditVerification } from './auditChainGate.js'
import { closeAuditOutage, reportAuditDegradation } from './auditOutage.js'
import { currentClock, systemClock, type Clock } from './clock.js'
import { env } from './env.js'
import { auditActionLabel } from './auditLabels.js'
import { immudbConfig, openLedger, type Ledger } from './auditLedger.js'
import { type SessionUser } from './authentication/index.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { AuditDetailPolicyError, validateAuditDetail } from './auditDetailPolicy.js'
import {
  CURRENT_AUDIT_SCHEMA_VERSION,
  upcastAuditEvent,
} from './auditSchema.js'
import {
  applyAuditQueryFilters,
  eventJobIds,
  eventSessionIds,
  eventWorkspaceIds,
} from './auditQueryFilters.js'
import { carryFromIntent, type TrackedReason } from './auditReasonFields.js'

export type { AuditVerification } from './auditChainGate.js'
export { eventJobIds, eventSessionIds, eventWorkspaceIds, applyAuditQueryFilters } from './auditQueryFilters.js'
export { carryFromIntent, intentReasonFields, type TrackedReason } from './auditReasonFields.js'

export type AuditVia = 'session' | 'pat'

export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

/** `intent` is written before a mutation runs, `outcome` after. Other events carry no phase. */
export type AuditPhase = 'intent' | 'outcome'

/** User-facing copy when a mutation is refused because the audit store cannot accept an Intent. */
export const AUDIT_UNAVAILABLE_MESSAGE = 'audit unavailable, nothing was saved'

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
  /** Stable namespace UUID; `namespace` remains the name snapshot at event time. */
  namespace_id?: string
  /** Stable repository UUID; `repo` remains the name snapshot at event time. */
  repository_id?: string
  message?: string
  /** Why the change was made (mandatory for dataset and admin mutations); `message` stays the commit message. */
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  /** Pick-list category when a reason is required (GxP ticket 03). */
  category?: string
  /** QMS change-control id when required (GxP ticket 04). */
  change_control_id?: string
  /** Electronic signature id when required on regulated mutations (GxP ticket 27). */
  signature_id?: string
  /** Dataset commit ids before and after a dataset mutation. */
  dataset?: { base?: string; head?: string }
  /** The mutation succeeded but its resulting dataset version could not be determined. */
  unverified?: true
  detail?: Record<string, unknown>
  /** Optional accountable human when the actor is automation attributed to a person. */
  owner?: AuditActor
  /** Hashed IP (SHA-256(IP + daily_salt)) for anomaly detection while preserving privacy (U8). */
  hashed_ip?: string
  /** Event shape version; readers upcast older blobs (US11 / Q19). */
  schema_version: number
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

/**
 * True while the last verification failed and the operator has not acknowledged that same
 * break. Dataset mutations are refused meanwhile. A different or later break blocks again.
 */
export function auditChainBlocked(): boolean {
  return auditChainGate.isBlocked()
}

/** Re-verifies and acknowledges the current break; null when the trail is intact. Held in memory, so a restart asks again. */
export async function acknowledgeAuditBreak(): Promise<{ seq: number; reason: string } | null> {
  await verifyAudit()
  return auditChainGate.acknowledge()
}

/** Evidence bundle for the events matching `query`, with a fresh verification of the ledger; see GLOSSARY "audit bundle". */
export async function buildAuditExportBundle(
  query: AuditQuery,
  exportedBy: AuditActor,
  filters: Record<string, unknown>,
): Promise<{ ok: true; bundle: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const {
      AUDIT_EXPORT_BUNDLE_FORMAT,
      auditEventsToPdf,
      auditExportPrivateKeyPem,
      auditExportPublicKeyPem,
      buildExportManifestBody,
      signAuditExportManifest,
    } = await import('./auditExport.js')
    const privateKeyPem = auditExportPrivateKeyPem()
    const publicKeyPem = auditExportPublicKeyPem()
    if (!privateKeyPem || !publicKeyPem) {
      return {
        ok: false,
        error: 'Audit export signing key is not configured (set AUDIT_EXPORT_PRIVATE_KEY)',
      }
    }
    const { events: found, truncated } = await queryAuditForExport(query)
    const verification = await verifyAudit()
    const exportedAt = new Date(currentClock.now()).toISOString()
    // Bundle events are chain order (oldest first); CSV/PDF keep newest-first browse order.
    const chainEvents = [...found].reverse()
    const manifestBody = buildExportManifestBody({
      exportedAt,
      exportedBy,
      events: chainEvents,
      truncated,
      verification,
      filters,
    })
    let signature: string
    try {
      signature = signAuditExportManifest(manifestBody, privateKeyPem)
    } catch (err) {
      return { ok: false, error: `Audit export signing failed: ${String((err as Error)?.message ?? err)}` }
    }
    const csv = auditEventsToCsv(found)
    const pdf = auditEventsToPdf(found)
    return {
      ok: true,
      bundle: {
        format: AUDIT_EXPORT_BUNDLE_FORMAT,
        exported_at: exportedAt,
        exported_by: exportedBy,
        range: filters,
        truncated,
        events: chainEvents,
        verification,
        manifest: { ...manifestBody, signature },
        public_key: publicKeyPem,
        csv,
        pdf_base64: pdf.toString('base64'),
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
  auditChainGate.recordVerification(result)
  return result
}

let lastAppendError: string | null = null

export type AuditReadiness = {
  ok: boolean
  store: 'ok' | 'error'
  chain: 'ok' | 'broken' | 'acknowledged' | 'unverified'
  events?: number
  verifiedAt?: string
  /** Tip tx id from the last successful verify — for IQP / change-control filing. */
  head?: number
  /** Tip root (base64 ALH) from the last successful verify. */
  root?: string
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
  const v = auditChainGate.current()
  const chainState = !v ? 'unverified' : v.ok ? 'ok' : auditChainBlocked() ? 'broken' : 'acknowledged'
  return {
    ok: store === 'ok' && chainState !== 'broken',
    store,
    chain: chainState,
    ...(v ? { events: v.events, verifiedAt: v.verifiedAt } : {}),
    ...(v && v.ok ? { head: v.head, root: v.root } : {}),
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
  opts: {
    clock?: Clock
    intervalMs?: number
    poll?: boolean
    /** Extra work after each verify tick (e.g. orphan-aging alert). */
    afterTick?: () => void | Promise<void>
  } = {},
): { tick(): Promise<boolean>; stop(): void } {
  const clock = opts.clock ?? systemClock
  const intervalMs = opts.intervalMs ?? env.auditVerifyIntervalSec * 1000
  let last = clock.now()
  const tick = async (): Promise<boolean> => {
    if (clock.now() - last < intervalMs) return false
    last = clock.now()
    const v = await verifyAudit()
    if (!v.ok) {
      console.error('[mice-auth] audit verification FAILED', v.firstBreak)
      void reportAuditDegradation({
        at: clock.now(),
        check: 'verify',
        requestId: 'verify',
        detail: v.firstBreak?.reason,
      }).catch((err) => console.error('[mice-auth] audit outage report failed', err))
    } else {
      void closeAuditOutage(clock.now()).catch((err) =>
        console.error('[mice-auth] audit outage close failed', err),
      )
    }
    if (opts.afterTick) {
      try {
        await opts.afterTick()
      } catch (err) {
        console.error('[mice-auth] audit schedule afterTick failed', err)
      }
    }
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(() => void tick(), Math.min(intervalMs, 60_000))
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}

export function actorFromUser(user: SessionUser): AuditActor {
  return {
    sub: user.sub,
    iss: canonicalIssuer(user.iss),
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

export type AuditInput = Omit<AuditEvent, 'id' | 'ts' | 'phase' | 'intent_id' | 'via' | 'schema_version'> & {
  id?: string
  ts?: string
  via: AuditVia | 'system'
  schema_version?: number
}

async function resolveEntityRefs(partial: AuditInput): Promise<{
  namespace?: string
  repo?: string
  namespace_id?: string
  repository_id?: string
}> {
  const { readNamespace, readNamespaceById, readRepository, readRepositoryById } = await import('./authzRepository.js')
  let namespace = partial.namespace
  let repo = partial.repo
  let namespace_id = partial.namespace_id
  let repository_id = partial.repository_id

  if (repository_id && (!namespace || !repo || !namespace_id)) {
    const row = await readRepositoryById(repository_id)
    if (row) {
      namespace ??= row.namespace
      repo ??= row.name
      namespace_id ??= row.namespaceId
    }
  }
  if (namespace_id && !namespace) {
    const row = await readNamespaceById(namespace_id)
    if (row) namespace = row.name
  }
  if (namespace && repo && !repository_id) {
    const row = await readRepository(namespace, repo)
    if (row) {
      repository_id = row.id
      namespace_id ??= row.namespaceId
    }
  }
  if (namespace && !namespace_id) {
    const row = await readNamespace(namespace)
    if (row) namespace_id = row.id
  }
  return {
    ...(namespace ? { namespace } : {}),
    ...(repo ? { repo } : {}),
    ...(namespace_id ? { namespace_id } : {}),
    ...(repository_id ? { repository_id } : {}),
  }
}

async function buildEvent(partial: AuditInput, extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object = {}): Promise<AuditEvent> {
  const refs = await resolveEntityRefs(partial)
  return {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    actor: partial.actor,
    via: partial.via,
    method: partial.method,
    path: partial.path,
    status: partial.status,
    action: partial.action,
    schema_version: partial.schema_version ?? CURRENT_AUDIT_SCHEMA_VERSION,
    ...refs,
    ...(partial.message ? { message: partial.message } : {}),
    ...(partial.reason
      ? {
          reason: partial.reason,
          reason_source: partial.reason_source,
          ...(partial.category ? { category: partial.category } : {}),
        }
      : {}),
    ...(partial.change_control_id ? { change_control_id: partial.change_control_id } : {}),
    ...(partial.signature_id ? { signature_id: partial.signature_id } : {}),
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
  const policy = validateAuditDetail({
    action: partial.action,
    reason: partial.reason,
    message: partial.message,
    detail: partial.detail,
  })
  if (!policy.ok) throw new AuditDetailPolicyError(policy.rejection)

  try {
    const event = await buildEvent(
      policy.detail !== undefined ? { ...partial, detail: policy.detail } : partial,
      extra,
    )
    const seq = await (await ledgerOrOpen()).append(event.id, JSON.stringify(event))
    lastAppendError = null
    void closeAuditOutage(currentClock.now()).catch((err) =>
      console.error('[mice-auth] audit outage close failed', err),
    )
    // Derived Postgres query index (not evidence); failures must not block the ledger write.
    try {
      const { projectAuditQueryIndex } = await import('./auditQueryIndex.js')
      await projectAuditQueryIndex(event, seq)
    } catch (err) {
      console.error('[mice-auth] audit query index project failed', err)
    }
    return event
  } catch (err) {
    if (err instanceof AuditDetailPolicyError) throw err
    lastAppendError = String(err)
    console.error('[mice-auth] audit append failed', err)
    void reportAuditDegradation({
      at: currentClock.now(),
      check: 'append',
      requestId: 'append',
      detail: String(err),
    }).catch((reportErr) => console.error('[mice-auth] audit outage report failed', reportErr))
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

const intents = new WeakMap<object, {
  id: string
  outcomes: number
  reason?: TrackedReason
}>()

/** Remembers the intent written for a request so native audit calls can link their outcome to it. */
export function trackIntent(request: object, intent: AuditEvent): void {
  const reason = carryFromIntent(intent)
  intents.set(request, {
    id: intent.id,
    outcomes: 0,
    ...(reason ? { reason } : {}),
  })
}

/**
 * Intent before the effect, tracked on the request for {@link appendOutcomeFor}.
 * Throws when the ledger cannot store the Intent — callers must refuse the mutation.
 */
export async function beginTrackedIntent(request: object, partial: AuditInput): Promise<AuditEvent> {
  const intent = await appendIntent(partial)
  trackIntent(request, intent)
  return intent
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

/** Intents with no matching Outcome — detectable orphans (ticket 12 reconciler is wontfix). */
export function orphanIntents(events: AuditEvent[]): AuditEvent[] {
  const resolved = new Set(
    events.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])),
  )
  return events.filter((e) => e.phase === 'intent' && !resolved.has(e.id))
}

/** Events written after ledger position `seq`; `scannedTo` is the position to resume from. */
export async function readAuditAfter(seq: number, limit?: number): Promise<{ events: AuditEvent[]; scannedTo: number }> {
  const { records, scannedTo } = await (await ledgerOrOpen()).readAfter(seq, limit)
  const events: AuditEvent[] = []
  for (const record of records) {
    try {
      events.push(upcastAuditEvent(JSON.parse(record.value)))
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return { events, scannedTo }
}

/** Like {@link readAuditAfter} but keeps ledger sequence numbers for index projection. */
export async function readAuditAfterWithSeq(
  seq: number,
  limit?: number,
): Promise<{ rows: Array<{ event: AuditEvent; seq: number }>; scannedTo: number }> {
  const { records, scannedTo } = await (await ledgerOrOpen()).readAfter(seq, limit)
  const rows: Array<{ event: AuditEvent; seq: number }> = []
  for (const record of records) {
    try {
      rows.push({ event: upcastAuditEvent(JSON.parse(record.value)), seq: record.seq })
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return { rows, scannedTo }
}

async function readAllEvents(): Promise<AuditEvent[]> {
  const out: AuditEvent[] = []
  for (const record of await (await ledgerOrOpen()).readAll()) {
    try {
      out.push(upcastAuditEvent(JSON.parse(record.value)))
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return out
}

/** Full trail for orphan scans and projections; not a filtered query API. */
export function listAllAuditEvents(): Promise<AuditEvent[]> {
  return readAllEvents()
}

async function filterEventsFromLedger(q: AuditQuery): Promise<AuditEvent[]> {
  const events = await readAllEvents()
  // Newest first, then shared filter pipeline (same as Postgres index path).
  return applyAuditQueryFilters([...events].reverse(), q)
}

/** Prefer the derived Postgres index when healthy; evidence path still uses immudb only. */
async function filterEvents(q: AuditQuery): Promise<AuditEvent[]> {
  try {
    const { queryAuditQueryIndex } = await import('./auditQueryIndex.js')
    const fromIndex = await queryAuditQueryIndex(q)
    if (fromIndex !== null) return fromIndex
  } catch (err) {
    console.error('[mice-auth] audit query index read failed; falling back to ledger', err)
  }
  return filterEventsFromLedger(q)
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
  'category',
  'change_control_id',
  'signature_id',
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
        e.category,
        e.change_control_id,
        e.signature_id,
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
