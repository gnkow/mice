import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-ann-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-announcements'

const { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement, AnnouncementError } =
  await import('./announcementsStore.js')

describe('announcements store', () => {
  after(() => rmSync(dataDir, { recursive: true, force: true }))

  it('validates input', () => {
    assert.throws(() => createAnnouncement({ title: ' ' }, 'a'), AnnouncementError)
    assert.throws(() => createAnnouncement({ title: 't', severity: 'loud' }, 'a'), /severity/)
    assert.throws(() => createAnnouncement({ title: 't', expiresAt: 'nope' }, 'a'), /expiresAt/)
  })

  it('shows only live announcements to non-admins', () => {
    const live = createAnnouncement({ title: 'Maintenance', message: 'Tonight', severity: 'warning' }, 'admin')
    const expired = createAnnouncement({ title: 'Old', expiresAt: '2000-01-01T00:00:00Z' }, 'admin')
    const draft = createAnnouncement({ title: 'Draft', active: false }, 'admin')
    const visible = listAnnouncements().map((a) => a.id)
    assert.deepEqual(visible, [live.id])
    const all = listAnnouncements({ all: true }).map((a) => a.id)
    assert.ok([live.id, expired.id, draft.id].every((id) => all.includes(id)))
  })

  it('updates and deletes', () => {
    const a = createAnnouncement({ title: 'x' }, 'admin')
    const u = updateAnnouncement(a.id, { active: false, expiresAt: null })
    assert.equal(u.active, false)
    assert.equal(u.title, 'x')
    deleteAnnouncement(a.id)
    assert.throws(() => updateAnnouncement(a.id, {}), /not found/)
  })
})
