import { randomBytes } from 'node:crypto'
import { EMPTY_AUDIT_CHANGE } from './auditChange.js'
import { AuditDetailPolicyError, validateAuditDetail } from './auditDetailPolicy.js'
import { createAuditIntentOutcome } from './auditIntentOutcome.js'
import { assertIntentAction } from './auditIntentAction.js'
import { closeAuditOutage, reportAuditDegradation } from './auditOutage.js'
import { auditResourceUri } from './auditResourceUri.js'
import { CURRENT_AUDIT_SCHEMA_VERSION } from './auditSchema.js'
import { currentClock } from '../../shared/index.js'
import {
  getLastAppendError,
  ledgerOrOpen,
  setLastAppendError,
} from './auditLedgerHandle.js'
import { observeAuditEvent } from './auditObserver.js'
import type { AuditEvent, AuditInput } from './auditTypes.js'

async function resolveEntityRefs(partial: AuditInput): Promise<{
  namespace?: string
  repo?: string
  namespace_id?: string
  repository_id?: string
}> {
  const { readNamespace, readNamespaceById, readRepository, readRepositoryById } = await import('../../authz/stores.js')
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

async function buildEvent(
  partial: AuditInput,
  extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object = {},
): Promise<AuditEvent> {
  const refs = await resolveEntityRefs(partial)
  const withRefs = { ...partial, ...refs }
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
    resource_uri: auditResourceUri(withRefs),
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
    change: partial.change ?? EMPTY_AUDIT_CHANGE,
    ...extra,
  }
}

async function appendStored(
  partial: AuditInput,
  extra: Pick<AuditEvent, 'phase' | 'intent_id'> | object,
): Promise<AuditEvent> {
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
    setLastAppendError(null)
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
    setLastAppendError(String(err))
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
    observeAuditEvent(event)
    return event
  } catch {
    return null
  }
}

/** Written before a mutation runs. Throws when it cannot be stored; the caller must then refuse the mutation. */
export async function appendIntent(partial: AuditInput): Promise<AuditEvent> {
  // Hard constraint: an Intent always names a concrete operation; `bff.mutation` is never written.
  assertIntentAction(partial.action, 'appendIntent')
  return appendStored(partial, { phase: 'intent' })
}

/** Written after a mutation ran, linked to its intent. Best-effort: the mutation already happened. */
export async function appendOutcome(intentId: string, partial: AuditInput): Promise<AuditEvent | null> {
  try {
    const event = await appendStored(partial, { phase: 'outcome', intent_id: intentId })
    observeAuditEvent(event)
    return event
  } catch {
    return null
  }
}

const intentOutcome = createAuditIntentOutcome<AuditEvent, AuditInput>({
  appendIntent,
  appendOutcome,
  appendAudit,
})

/** Remembers the intent written for a request so native audit calls can link their outcome to it. */
export const trackIntent = intentOutcome.trackIntent

/**
 * Intent before the effect, tracked on the request for {@link appendOutcomeFor}.
 * Throws when the ledger cannot store the Intent — callers must refuse the mutation.
 */
export const beginTrackedIntent = intentOutcome.beginTrackedIntent

/** Appends an outcome for the request's tracked intent, or a plain event when it has none. */
export const appendOutcomeFor = intentOutcome.appendOutcomeFor

export const trackedIntent = intentOutcome.trackedIntent

/** Exposed for readiness probes that report the last failed append. */
export { getLastAppendError }
