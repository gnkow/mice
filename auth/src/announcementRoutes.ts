import type { Context, Hono } from 'hono'
import { decideInstanceAction } from './authz.js'
import { instanceGate } from './decisionHttp.js'
import { guarded } from './authentication/index.js'
import type { AuditDep } from './routeDeps.js'
import { AnnouncementError, createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement, type Announcement } from './announcementsStore.js'
import { requireAuditChange } from './auditChange.js'
import { captureBefore, pickSnapshot } from './auditCapture.js'

const adminOnly = instanceGate('instance.admin')

/** Audited announcement state; bookkeeping timestamps stay out so a no-op PATCH is detectable. */
function announcementSnapshot(a: Announcement | null): Record<string, unknown> | null {
  return pickSnapshot(a, ['id', 'title', 'message', 'severity', 'active', 'expiresAt'])
}

function announcementFail(err: unknown, c: Context) {
  if (err instanceof AnnouncementError) return c.json({ error: err.message }, err.status)
  return null
}

/** Instance announcements: any signed-in user reads live ones; instance admins manage. */
export function registerAnnouncementRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/announcements', guarded({}, async ({ c, user, deny }) => {
    const wantAll = c.req.query('all') === '1'
    if (wantAll) {
      const denied = deny(await decideInstanceAction(user, 'instance.admin'))
      if (denied) return denied
    }
    return c.json({ announcements: await listAnnouncements({ all: wantAll }) })
  }))

  app.post('/auth/announcements', guarded({ gate: adminOnly, body: 'optional', fail: announcementFail }, async ({ c, user, body }) => {
    const row = await createAnnouncement(body, `${user.name || user.email || user.sub}`)
    await auditMutation(c, user, 'session', {
      action: 'announcement.create',
      change: requireAuditChange(null, announcementSnapshot(row)),
      message: `Published announcement "${row.title}"`,
      detail: { announcementId: row.id, severity: row.severity },
    })
    return c.json({ announcement: row }, 201)
  }))

  app.patch('/auth/announcements/:id', guarded({ gate: adminOnly, body: 'optional', fail: announcementFail }, async ({ c, user, body }) => {
    const id = c.req.param('id')
    const before = (await captureBefore(() => listAnnouncements({ all: true }))).find((a) => a.id === id)
    if (!before) throw new AnnouncementError('Announcement not found', 404)
    const row = await updateAnnouncement(id, body)
    await auditMutation(c, user, 'session', {
      action: 'announcement.update',
      change: requireAuditChange(announcementSnapshot(before), announcementSnapshot(row)),
      message: `Updated announcement "${row.title}"`,
      detail: { announcementId: row.id, active: row.active },
    })
    return c.json({ announcement: row })
  }))

  app.delete('/auth/announcements/:id', guarded({ gate: adminOnly, fail: announcementFail }, async ({ c, user }) => {
    const row = await deleteAnnouncement(c.req.param('id'))
    await auditMutation(c, user, 'session', {
      action: 'announcement.delete',
      change: requireAuditChange(announcementSnapshot(row), null),
      message: `Deleted announcement "${row.title}"`,
      detail: { announcementId: row.id },
    })
    return c.json({ ok: true })
  }))
}
