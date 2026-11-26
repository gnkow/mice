import { actorFromUser } from './auditActor.js'
import { appendOutcomeFor } from './auditAppend.js'
import { EMPTY_AUDIT_CHANGE } from './auditChange.js'
import type { AuditVia } from './auditTypes.js'
import { callerVia } from '../../authentication/session.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditFn } from '../../shared/index.js'

/** Appends an audit event for a BFF-native (non-proxied) mutation. Never pass secrets in `detail`. */
export const auditMutation: AuditFn = async (c, user, via: AuditVia, fields) => {
  await appendOutcomeFor(c.req.raw, {
    actor: actorFromUser(user as SessionUser),
    via: callerVia(c, via),
    method: c.req.method,
    path: c.req.path,
    status: fields.status ?? 200,
    action: fields.action,
    change: fields.change ?? EMPTY_AUDIT_CHANGE,
    ...(fields.message ? { message: fields.message } : {}),
    ...(fields.namespace ? { namespace: fields.namespace } : {}),
    ...(fields.repo ? { repo: fields.repo } : {}),
    ...(fields.detail ? { detail: fields.detail } : {}),
  })
}
