import {
  auditChange,
  EMPTY_AUDIT_CHANGE,
  requireAuditChange,
  type AuditChange,
} from '../auditChange.js'

type Detail = Record<string, unknown>

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** `ns/repo/commit`, skipping parts the event did not carry. */
function checkoutKey(e: { namespace?: string; repo?: string; detail: Detail }): string {
  const commit = typeof e.detail.commit === 'string' ? e.detail.commit : undefined
  return [e.namespace, e.repo, commit].filter((p): p is string => typeof p === 'string' && p !== '').join('/')
}

/**
 * The audit change of a system store event (`onAudit` in `workspaces/routes.ts`), derived from the
 * event's own detail:
 *
 * - `checkout.build`: null → the built checkout (key, commit, path, size counters).
 * - `checkout.evict`: the evicted checkout (commit, files, bytes) → null.
 * - `checkout.corrupt`: `checkout.<key>` ready → corrupt.
 * - `store.gc`: blob / byte counts before → after, when the event states them.
 * - `store.full`: a capacity signal, no state moved ({@link EMPTY_AUDIT_CHANGE}, classified non_mutation).
 */
export function storeEventChange(e: {
  action: string
  namespace?: string
  repo?: string
  detail: Detail
}): AuditChange {
  const d = e.detail
  switch (e.action) {
    case 'checkout.build': {
      const key = checkoutKey(e)
      return requireAuditChange(null, {
        checkout: key,
        commit: d.commit ?? null,
        path: typeof d.path === 'string' ? d.path : key,
        files: d.files ?? null,
        bytes: d.bytes ?? null,
        new_bytes: d.new_bytes ?? null,
        downloaded_files: d.downloaded_files ?? null,
        linked_files: d.linked_files ?? null,
      })
    }
    case 'checkout.evict': {
      const key = checkoutKey(e)
      return requireAuditChange(
        {
          checkout: key,
          commit: d.commit ?? null,
          path: typeof d.path === 'string' ? d.path : key,
          files: d.files ?? null,
          bytes: d.bytes ?? null,
        },
        null,
      )
    }
    case 'checkout.corrupt': {
      const key = `checkout.${checkoutKey(e)}`
      return requireAuditChange({ [key]: 'ready' }, { [key]: 'corrupt' })
    }
    case 'store.gc': {
      const blobCount = num(d.blob_count)
      const blobsDeleted = num(d.blobs_deleted)
      const storeBytes = num(d.store_bytes)
      const bytesFreed = num(d.bytes_freed)
      const before: Detail = {}
      const after: Detail = {}
      if (blobCount !== undefined) {
        before.blob_count = blobCount + (blobsDeleted ?? 0)
        after.blob_count = blobCount
      }
      if (storeBytes !== undefined) {
        before.store_bytes = storeBytes + (bytesFreed ?? 0)
        after.store_bytes = storeBytes
      }
      const swept = num(d.swept_tmp)
      if (swept !== undefined) {
        before.tmp_files = swept
        after.tmp_files = 0
      }
      if (Array.isArray(d.evicted)) {
        for (const key of d.evicted) {
          before[`checkout.${String(key)}`] = 'ready'
          after[`checkout.${String(key)}`] = null
        }
      }
      // A run that collected nothing moved no state: empty, truthfully.
      return auditChange(before, after)
    }
    default:
      // store.full (capacity signal) and anything unlisted: no state moved.
      return EMPTY_AUDIT_CHANGE
  }
}

/**
 * The audit change of a system lease event (`onLeaseEvent`): an automatic release
 * (`expired` / `workspace_gone` / `holder_gone`) takes the held lease → null, like a manual release.
 */
export function leaseEventChange(e: { action: string; detail: Detail }): AuditChange {
  const d = e.detail
  if (e.action !== 'workspace.lease.release') return EMPTY_AUDIT_CHANGE
  return requireAuditChange(
    {
      lease_id: d.lease_id ?? null,
      workspace_id: d.workspace_id ?? null,
      mode: d.mode ?? null,
      holder: d.holder ?? null,
    },
    null,
  )
}
