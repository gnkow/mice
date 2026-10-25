import { actorFromUser, appendOutcomeFor, type AuditVia } from './audit.js'
import { callerVia } from './requireAuth.js'
import type { AuditFn } from './routeDeps.js'
import type { SessionUser } from './session.js'

/** Appends an audit event for a BFF-native (non-proxied) mutation. Never pass secrets in `detail`. */
export const auditMutation: AuditFn = async (c, user, via: AuditVia, fields) => {
  await appendOutcomeFor(c.req.raw, {
    actor: actorFromUser(user as SessionUser),
    via: callerVia(c, via),
    method: c.req.method,
    path: c.req.path,
    status: fields.status ?? 200,
    action: fields.action,
    ...(fields.message ? { message: fields.message } : {}),
    ...(fields.namespace ? { namespace: fields.namespace } : {}),
    ...(fields.repo ? { repo: fields.repo } : {}),
    ...(fields.detail ? { detail: fields.detail } : {}),
  })
}
