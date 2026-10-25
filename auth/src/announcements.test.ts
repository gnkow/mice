import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.SESSION_SECRET = 'test-session-secret-for-announcements'

const { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement, AnnouncementError } =
  await import('./announcementsStore.js')

describe('announcements store', () => {
  it('validates input', async () => {
    await assert.rejects(() => createAnnouncement({ title: ' ' }, 'a'), AnnouncementError)
    await assert.rejects(() => createAnnouncement({ title: 't', severity: 'loud' }, 'a'), /severity/)
    await assert.rejects(() => createAnnouncement({ title: 't', expiresAt: 'nope' }, 'a'), /expiresAt/)
  })

  it('shows only live announcements to non-admins', async () => {
    const live = await createAnnouncement({ title: 'Maintenance', message: 'Tonight', severity: 'warning' }, 'admin')
    const expired = await createAnnouncement({ title: 'Old', expiresAt: '2000-01-01T00:00:00Z' }, 'admin')
    const draft = await createAnnouncement({ title: 'Draft', active: false }, 'admin')
    const visible = (await listAnnouncements()).map((a) => a.id)
    assert.deepEqual(visible, [live.id])
    const all = (await listAnnouncements({ all: true })).map((a) => a.id)
    assert.ok([live.id, expired.id, draft.id].every((id) => all.includes(id)))
  })

  it('updates and deletes', async () => {
    const a = await createAnnouncement({ title: 'x' }, 'admin')
    const u = await updateAnnouncement(a.id, { active: false, expiresAt: null })
    assert.equal(u.active, false)
    assert.equal(u.title, 'x')
    await deleteAnnouncement(a.id)
    await assert.rejects(() => updateAnnouncement(a.id, {}), /not found/)
  })
})
