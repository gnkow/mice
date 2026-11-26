import type { Hono } from 'hono'
import { instanceGate } from '../../authz/http.js'
import type { AuditDep } from '../../shared/index.js'
import { guarded } from '../../authentication/session.js'
import { requireAuditChange } from './auditChange.js'
import { captureBefore } from './auditCapture.js'
import {
  getAuditVisibility,
  listAuditVisibilityActions,
  normalizeHiddenActions,
  resetAuditVisibilityToDefaults,
  setAuditVisibility,
} from './auditVisibility.js'

const adminOnly = instanceGate('instance.admin')

/** One `hidden.<action>` key per hidden action, so the delta lists only toggled actions. */
function visibilitySnapshot(hiddenActions: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(hiddenActions.map((a) => [`hidden.${a}`, true]))
}

/** Admin Audit Visibility: which ledger actions Auditors may see in list/export. */
export function registerAuditVisibilityRoutes(app: Hono, { audit }: AuditDep): void {
  app.get(
    '/auth/admin/audit-visibility',
    guarded({ gate: adminOnly }, async ({ c }) => c.json(await listAuditVisibilityActions())),
  )

  app.put(
    '/auth/admin/audit-visibility',
    guarded({ mutates: true, action: 'audit.visibility.update', reason: true, gate: adminOnly, body: 'json' }, async ({ c, user, body }) => {
      const raw = body && typeof body === 'object' ? (body as { hiddenActions?: unknown; reset?: unknown }) : {}
      const before = await captureBefore(() => getAuditVisibility())
      let state
      if (raw.reset === true) {
        state = await resetAuditVisibilityToDefaults()
      } else {
        const normalized = normalizeHiddenActions(raw.hiddenActions)
        if ('error' in normalized) return c.json({ error: normalized.error }, 400)
        state = await setAuditVisibility(normalized)
      }
      await audit(c, user, 'session', {
        action: 'audit.visibility.update',
        change: requireAuditChange(
          visibilitySnapshot(before.hiddenActions),
          visibilitySnapshot(state.hiddenActions),
        ),
        message: raw.reset
          ? 'Restored default Auditor audit visibility'
          : `Updated Auditor audit visibility (${state.hiddenActions.length} hidden)`,
        detail: {
          hiddenActions: state.hiddenActions,
          previousHiddenActions: before.hiddenActions,
          reset: raw.reset === true,
        },
      })
      return c.json(await listAuditVisibilityActions())
    }),
  )
}
