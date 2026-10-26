import type { Context } from 'hono'
import type { AuditVia } from './audit.js'
import type { SessionUser } from './authentication/session/session.js'

export type AuditFields = {
  action: string
  message?: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
  status?: number
}

/** Appends an audit event for a BFF-native mutation; injected so route modules need no whole-app setup. */
export type AuditFn = (
  c: Context,
  user: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>,
  via: AuditVia,
  fields: AuditFields,
) => Promise<void>

export type AuditDep = { audit: AuditFn }
