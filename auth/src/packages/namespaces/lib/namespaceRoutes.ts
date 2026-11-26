import type { Hono } from 'hono'
import type { AuditDep } from '../../shared/index.js'
import { guarded } from '../../authentication/session.js'
import { isResponse } from './httpOutcome.js'
import {
  createNamespaceUseCase,
  deleteNamespaceUseCase,
  getNamespaceUseCase,
  listNamespacesUseCase,
  namespaceMembersHistoryUseCase,
  namespaceSettingsHistoryUseCase,
  updateNamespaceUseCase,
} from './namespaceLifecycle.js'
import { registerNamespaceAccessRoutes } from './namespaceAccess.js'

function mapOutcome(c: { json: (body: unknown, status?: number) => Response }, outcome: import('./httpOutcome.js').HttpOutcome) {
  if (isResponse(outcome)) return outcome.response
  return c.json(outcome.body as never, outcome.status as never)
}

/** Namespaces, members, repo collaborators and custom roles. Thin HTTP adapter. */
export function registerNamespaceRoutes(app: Hono, deps: AuditDep): void {
  const { audit: auditMutation } = deps

  app.get('/auth/namespaces', guarded({}, async ({ c, user: session }) => {
    return mapOutcome(c, await listNamespacesUseCase(session))
  }))

  app.post('/auth/namespaces', guarded({ mutates: true, action: 'namespace.create' }, async ({ c, user: session }) => {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    return mapOutcome(
      c,
      await createNamespaceUseCase({
        c,
        session,
        body: body as never,
        audit: (fields) => auditMutation(c, session, 'session', fields),
      }),
    )
  }))

  app.get('/auth/namespaces/:ns', guarded({}, async ({ c, user: session }) => {
    return mapOutcome(c, await getNamespaceUseCase({ c, session, ns: c.req.param('ns') }))
  }))

  app.get('/auth/namespaces/:ns/settings/history', guarded({}, async ({ c, user: session }) => {
    return mapOutcome(
      c,
      await namespaceSettingsHistoryUseCase({ c, session, ns: c.req.param('ns') }),
    )
  }))

  app.get('/auth/namespaces/:ns/members/history', guarded({}, async ({ c, user: session }) => {
    return mapOutcome(
      c,
      await namespaceMembersHistoryUseCase({ c, session, ns: c.req.param('ns') }),
    )
  }))

  app.patch(
    '/auth/namespaces/:ns',
    guarded(
      { mutates: true, action: 'namespace.settings.update', reason: true, body: 'optional' },
      async ({ c, user: session, body: raw }) => {
        return mapOutcome(
          c,
          await updateNamespaceUseCase({
            c,
            session,
            ns: c.req.param('ns'),
            body: raw as never,
            audit: (fields) => auditMutation(c, session, 'session', fields),
          }),
        )
      },
    ),
  )

  app.delete(
    '/auth/namespaces/:ns',
    guarded(
      { mutates: true, action: 'namespace.delete', reason: true, body: 'optional' },
      async ({ c, user: session, body: raw }) => {
        return mapOutcome(
          c,
          await deleteNamespaceUseCase({
            c,
            session,
            ns: c.req.param('ns'),
            body: raw,
            audit: (fields) => auditMutation(c, session, 'session', fields),
          }),
        )
      },
    ),
  )

  registerNamespaceAccessRoutes(app, deps)
}
