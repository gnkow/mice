import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'mice-sesswk-'))
process.env.AUTH_DATA_DIR = root
process.env.SESSIONS_DATA_DIR = join(root, 'sessions')
process.env.WORKSPACES_STORE_DIR = join(root, 'store')
process.env.WORKSPACES_DIR = join(root, 'workspaces')
process.env.WORKSPACES_UID = String(process.getuid!())
process.env.WORKSPACES_GID = String(process.getgid!())
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.SESSIONS_ENABLED = 'true'
process.env.SESSIONS_PROVISIONER = 'mock'
process.env.SESSIONS_MAX_PER_USER = '50'
process.env.SESSIONS_MAX_MOUNTS = '8'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'

const { CheckoutStore } = await import('./workspaces/checkout.js')
const { loadWorkspacesConfig } = await import('./workspaces/config.js')
const { WorkspaceService, setWorkspaceService } = await import('./workspaces/workspaces.js')
const { LeaseError } = await import('./workspaces/leases.js')
const { resetHostVolumePathsForTest } = await import('./workspaces/capabilities.js')
const { FakeOxen } = await import('./workspaces/fakeOxen.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { preparePrincipal } = await import('./authz.js')
const sessions = await import('./sessions.js')
const { getSessionRecord, updateSession } = await import('./sessionsStore.js')
const sw = await import('./sessionsWorkspaces.js')

resetHostVolumePathsForTest({ store: '/host/store', ws: '/host/ws' })

const C1 = 'c1111111111111111111111111111111'
const { assignRole } = await import('./rbacStore.js')
const { ensurePrincipal } = await import('./authentication/session/session.js')
const admin: { sub: string; iss: string; email: string; emailVerified?: boolean; name: string } = { sub: 'admin', iss: 'test', email: 'admin@mice.local', emailVerified: true, name: 'Admin' }
const reader = { sub: 'reader', iss: 'test', email: 'reader@example.com', name: 'Reader' }
/** User role: can connect to own sessions but not session.admin (unlike Manager). */
const other = { sub: 'other', iss: 'test', email: 'other@example.com', name: 'Other' }
await assignRole({ actor: null, target: admin, role: 'manager', reason: 'test', bootstrap: true })
await ensurePrincipal(reader)
await assignRole({ actor: null, target: reader, role: 'manager', reason: 'test', bootstrap: true })
await ensurePrincipal(other)
await assignRole({ actor: null, target: other, role: 'user', reason: 'test', bootstrap: true })
await createNamespaceAuthz(admin, 'rns', 'read', true)
await setNamespaceMember('rns', reader, 'member')
await setNamespaceMember('rns', other, 'member')

const fakeDocker = () => ({
  volumes: new Map<string, string[]>(),
  volumeExists: async function (n: string) { return this.volumes.has(n) },
  volumeCreate: async function (n: string, o: string[]) { this.volumes.set(n, o) },
  volumeRm: async function (n: string) { this.volumes.delete(n) },
  volumeList: async function (p: string) { return [...this.volumes.keys()].filter((n) => n.startsWith(p)) },
})

const oxen = new FakeOxen()
oxen.commit(C1, { 'README.md': 'hello', 'src/a.txt': 'aaa' }, 'main')
const cfg = {
  ...loadWorkspacesConfig(),
  downloadConcurrency: 1,
  downloadRetries: 0,
  downloadRetryBaseMs: 1,
  blobMinAgeMs: 0,
  scanTtlMs: 0,
  leaseOrphanGraceMs: 0,
  leaseReconcileSec: 0,
}
const holder: { svc?: InstanceType<typeof WorkspaceService> } = {}
const store = new CheckoutStore({ cfg, oxen, refs: () => holder.svc?.referencedCheckouts() ?? [] })
const svc = new WorkspaceService({
  store,
  cfg,
  docker: fakeDocker(),
  pickDriver: async () => 'overlay',
  readMarkers: async () => new Map(),
})
holder.svc = svc
await store.init()
await svc.init()
setWorkspaceService(svc)

let n = 0
async function mkWs(ns = 'rns', waitReady = true) {
  const ws = await svc.create({
    namespace: ns,
    repo: 'r',
    name: `ws${++n}`,
    source: { branch: 'main' },
    createdBy: { email: 'a@b.c', sub: 's1' },
  })
  if (waitReady) await svc.whenSettled(ws.id)
  return ws.id
}

async function ready(id: string) {
  for (let i = 0; i < 200; i++) {
    if ((await getSessionRecord(id))?.status === 'ready') return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`session ${id} not ready: ${(await getSessionRecord(id))?.status}`)
}

const create = (user: typeof admin, mounts: unknown[]) => {
  const parsed = sessions.parseCreateBody({ mounts })
  if ('error' in parsed) throw new Error(parsed.error)
  return sessions.createDesktopSession(user as never, 'session', parsed)
}

const mountOf = async (id: string) => (await getSessionRecord(id))!.mounts[0]!

after(() => {
  svc.shutdown()
  sw.stopSessionLeaseRenewerForTest()
  rmSync(root, { recursive: true, force: true })
})

await describe('parse + shape', async () => {
  await it('accepts workspace_id without namespace/repo; rejects mixes and stage ids', () => {
    const ok = sessions.parseCreateBody({ mounts: [{ workspace_id: 'w_abcdefghij', mount_mode: 'ro' }] })
    assert.ok(!('error' in ok))
    assert.equal((ok as { mounts: { workspace_id: string }[] }).mounts[0]!.workspace_id, 'w_abcdefghij')
    assert.ok('error' in sessions.parseCreateBody({ mounts: [{ workspace_id: 'w_abcdefghij', pin_commit: 'abc' }] }))
    assert.ok('error' in sessions.parseCreateBody({ mounts: [{ namespace: 'n', repo: 'r', workspace_id: 'stage-uuid' }] }))
  })
})

await describe('workspace mounts in sessions', async () => {
  await it('rw mount takes the write lease; JSON carries effective_mode, lease_id, workspace_ids', async () => {
    const w = await mkWs()
    const s = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    const pub = sessions.publicSession(s)
    const m = pub.mounts[0]!
    assert.equal(m.workspace_id, w)
    assert.equal(m.mount_mode, 'rw')
    assert.equal(m.effective_mode, 'rw')
    assert.equal(m.namespace, 'rns')
    assert.equal(m.repo, 'r')
    assert.equal(m.pin_commit, null)
    assert.equal(m.mount_path, `/data/rns/r__${w}`)
    assert.deepEqual(pub.notices, [])
    assert.deepEqual(pub.workspace_ids, [w])
    const lease = svc.leases.writer(w)!
    assert.equal(lease.id, m.lease_id)
    assert.equal(lease.holder.kind, 'session')
    assert.equal(lease.holder.id, s.id)
    assert.equal((await svc.get(w)).session_count, 1)
    await ready(s.id)
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
  })

  await it('second rw session degrades to ro with a notice naming the holder; ro with a writer is fine', async () => {
    const w = await mkWs()
    const a = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    const b = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    const mb = await mountOf(b.id)
    assert.equal(mb.mount_mode, 'rw')
    assert.equal(mb.effective_mode, 'ro')
    const notice = (await getSessionRecord(b.id))!.notices![0]!
    assert.match(notice, /being written by session/)
    assert.match(notice, /mounted read-only/)
    assert.equal(svc.leases.get(mb.lease_id!)!.mode, 'read')

    const c = await create(admin, [{ workspace_id: w, mount_mode: 'ro' }])
    assert.equal((await mountOf(c.id)).effective_mode, 'ro')
    assert.deepEqual((await getSessionRecord(c.id))!.notices, [])
    assert.equal(svc.leases.list(w).length, 3)
    assert.equal((await svc.get(w)).session_count, 3)

    const listed = await sessions.listDesktopSessions({ user: admin as never, workspaceId: w })
    assert.equal(listed.length, 3)
    assert.equal((await sessions.listDesktopSessions({ user: admin as never, workspaceId: 'w_nonexistent' })).length, 0)
    for (const s of [a, b, c]) {
      await ready(s.id)
      await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    }
  })

  await it('stop releases leases; delete is 423 naming the session while it runs', async () => {
    const w = await mkWs()
    const s = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    await ready(s.id)
    await assert.rejects(svc.delete(w), (e: unknown) => {
      assert.ok(e instanceof LeaseError)
      assert.equal(e.status, 423)
      assert.ok(e.message.includes('session '), e.message)
      return true
    })
    await sessions.stopDesktopSession(admin as never, 'session', s.id)
    assert.equal(svc.leases.list(w).length, 0)
    await sessions.retryDesktopSession(admin as never, 'session', s.id)
    assert.equal(svc.leases.writer(w)?.holder.id, s.id)
    assert.equal((await mountOf(s.id)).effective_mode, 'rw')
    await ready(s.id)
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    assert.equal(svc.leases.list(w).length, 0)
    await svc.delete(w)
  })

  await it('a workspace that is not ready → 409 at create; unknown → 404', async () => {
    const w = await mkWs('rns', false)
    await svc.whenSettled(w)
    // Force not-ready after prepare finishes so background work cannot overwrite the status.
    svc.getState(w)!.status = 'preparing' as never
    await assert.rejects(create(admin, [{ workspace_id: w, mount_mode: 'ro' }]), (e: unknown) => (e as { status?: number }).status === 409)
    await assert.rejects(create(admin, [{ workspace_id: 'w_zzzzzzzzzz' }]), (e: unknown) => (e as { status?: number }).status === 404)
    svc.getState(w)!.status = 'ready' as never
  })

  await it('repo-read user can mount ro but not rw', async () => {
    const w = await mkWs()
    await assert.rejects(create(reader, [{ workspace_id: w, mount_mode: 'rw' }]), (e: unknown) => (e as { status?: number }).status === 403)
    assert.equal(svc.leases.list(w).length, 0)
    const s = await create(reader, [{ workspace_id: w, mount_mode: 'ro' }])
    assert.equal((await mountOf(s.id)).effective_mode, 'ro')
    await ready(s.id)
    await sessions.destroyDesktopSession(reader as never, 'session', s.id)
  })

  await it('multi-workspace acquire is all-or-nothing', async () => {
    const a = await mkWs()
    const b = await mkWs()
    const stB = svc.getState(b)!
    stB.status = 'error' as never
    await assert.rejects(
      create(admin, [
        { workspace_id: a, mount_mode: 'rw' },
        { workspace_id: b, mount_mode: 'ro' },
      ]),
      (e: unknown) => (e as { status?: number }).status === 409,
    )
    assert.equal(svc.leases.list(a).length, 0)
    assert.equal(svc.leases.list(b).length, 0)
    stB.status = 'ready'
    const s = await create(admin, [
      { workspace_id: a, mount_mode: 'rw' },
      { workspace_id: b, mount_mode: 'rw' },
    ])
    assert.deepEqual([...sessions.publicSession(s).workspace_ids].sort(), [a, b].sort())
    await ready(s.id)
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    assert.equal(svc.leases.list(a).length + svc.leases.list(b).length, 0)
  })

  await it('rejects mounting the same workspace twice', async () => {
    const w = await mkWs()
    await assert.rejects(
      create(admin, [{ workspace_id: w }, { workspace_id: w, mount_mode: 'ro' }]),
      (e: unknown) => (e as { status?: number }).status === 400,
    )
  })

  await it('pin mounts are rejected at create (400 message)', () => {
    const parsed = sessions.parseCreateBody({ mounts: [{ namespace: 'rns', repo: 'r', pin_commit: 'abc123' }] })
    assert.deepEqual(parsed, { error: 'sessions mount workspaces: use workspace_id' })
  })

  await it('mountable_modes: rw+ro when free, ro while a writer exists; sessions list by repo', async () => {
    const w = await mkWs()
    assert.deepEqual((await svc.get(w)).mountable_modes, ['ro', 'rw'])
    const a = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    assert.deepEqual((await svc.get(w)).mountable_modes, ['ro'])
    assert.deepEqual(svc.list({ namespace: 'rns', repo: 'r' }).find((x) => x.id === w)!.mountable_modes, ['ro'])
    const byRepo = await sessions.listDesktopSessions({ user: admin as never, namespace: 'rns', repo: 'r' })
    assert.ok(byRepo.some((x) => x.id === a.id))
    assert.equal((await sessions.listDesktopSessions({ user: admin as never, namespace: 'rns', repo: 'other' })).length, 0)
    assert.equal((await sessions.listDesktopSessions({ user: admin as never, namespace: 'nope' })).length, 0)
    await ready(a.id)
    await sessions.destroyDesktopSession(admin as never, 'session', a.id)
    assert.deepEqual((await svc.get(w)).mountable_modes, ['ro', 'rw'])
  })

  await it('workspace delete is 423 naming the session even when its lease is missing', async () => {
    const w = await mkWs()
    const s = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    await ready(s.id)
    await svc.leases.release((await mountOf(s.id)).lease_id!)
    assert.equal(svc.leases.list(w).length, 0)
    await assert.rejects(svc.delete(w), (e: unknown) => {
      assert.ok(e instanceof LeaseError)
      assert.equal(e.status, 423)
      assert.ok(e.message.includes(`session ${s.id.slice(0, 8)}`), e.message)
      return true
    })
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    await svc.delete(w)
  })

  await it('new_workspace: created on demand, leased at provision time', async () => {
    const { queryAudit } = await import('./audit.js')
    const s = await create(admin, [{ new_workspace: { namespace: 'rns', repo: 'r', name: 'ondemand', source: { branch: 'main' } }, mount_mode: 'rw' }])
    const m = await mountOf(s.id)
    assert.match(m.workspace_id!, /^w_[0-9a-z]{10}$/)
    assert.equal(m.namespace, 'rns')
    assert.equal(m.effective_mode, undefined)
    assert.ok(!m.lease_id)
    assert.equal(svc.getState(m.workspace_id!)!.name, 'ondemand')
    assert.deepEqual(sessions.publicSession(s).workspace_ids, [m.workspace_id])
    await ready(s.id)
    const done = await mountOf(s.id)
    assert.equal(done.effective_mode, 'rw')
    assert.equal(svc.leases.writer(done.workspace_id!)?.holder.id, s.id)
    const ev = (await queryAudit({ action: 'workspace.create' })).events.find((e) => (e.detail as { session_id?: string })?.session_id === s.id)
    assert.ok(ev)
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    assert.equal(svc.leases.list(done.workspace_id!).length, 0)
  })

  await it('new_workspace: authz needs repo write; a failing workspace fails the session; bad input → 400', async () => {
    await assert.rejects(
      create(reader, [{ new_workspace: { namespace: 'rns', repo: 'r', source: { branch: 'main' } } }]),
      (e: unknown) => (e as { status?: number }).status === 403,
    )
    assert.ok('error' in sessions.parseCreateBody({ mounts: [{ new_workspace: { namespace: 'rns', repo: 'r' } }] }))
    assert.ok('error' in sessions.parseCreateBody({ mounts: [{ new_workspace: { namespace: 'rns', repo: 'r', source: { branch: 'a', commit: 'b' } } }] }))
    assert.ok('error' in sessions.parseCreateBody({ mounts: [{ workspace_id: 'w_abcdefghij', new_workspace: { namespace: 'rns', repo: 'r', source: { branch: 'a' } } }] }))
    const s = await create(admin, [{ new_workspace: { namespace: 'rns', repo: 'r', name: 'doomed', source: { branch: 'does-not-exist' } } }])
    for (let i = 0; i < 300 && (await getSessionRecord(s.id))!.status === 'provisioning'; i++) await new Promise((r) => setTimeout(r, 20))
    const failed = (await getSessionRecord(s.id))!
    assert.equal(failed.status, 'failed')
    assert.match(failed.error!, /failed to prepare/)
    assert.equal(svc.leases.list((await mountOf(s.id)).workspace_id!).length, 0)
  })

  await it('remount upgrades a degraded mount once the writer ended; 423 while it is still held', async () => {
    const w = await mkWs()
    const a = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    const b = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    await ready(a.id)
    await ready(b.id)
    await assert.rejects(
      sessions.remountDesktopSession(admin as never, 'session', b.id),
      (e: unknown) => (e as { status?: number }).status === 423,
    )
    await assert.rejects(
      sessions.remountDesktopSession(admin as never, 'session', a.id),
      (e: unknown) => (e as { status?: number }).status === 409,
    )
    await sessions.destroyDesktopSession(admin as never, 'session', a.id)
    await sessions.remountDesktopSession(admin as never, 'session', b.id, { workspace_id: w })
    assert.equal((await mountOf(b.id)).effective_mode, 'rw')
    assert.equal(svc.leases.writer(w)?.holder.id, b.id)
    await ready(b.id)
    await sessions.destroyDesktopSession(admin as never, 'session', b.id)
  })

  await it('PUT mounts: switch mode, add, remove; keeps path + session id; audited', async () => {
    const { queryAudit } = await import('./audit.js')
    const w1 = await mkWs()
    const w2 = await mkWs()
    const s = await create(admin, [{ workspace_id: w1, mount_mode: 'rw' }])
    await ready(s.id)
    const owner = svc.leases.writer(w1)!
    assert.equal(owner.holder.id, s.id)
    const put = (mounts: unknown[], u = admin) => {
      const parsed = sessions.parseMountsList(mounts)
      if ('error' in parsed) throw new Error(parsed.error)
      return sessions.updateSessionMounts(u as never, 'session', s.id, parsed)
    }
    // rw -> ro and add a second workspace rw
    let pub = await put([{ workspace_id: w1, mount_mode: 'ro' }, { workspace_id: w2, mount_mode: 'rw' }])
    assert.equal(pub.id, s.id)
    assert.equal(pub.status, 'provisioning')
    const m1 = pub.mounts.find((m) => m.workspace_id === w1)!
    assert.equal(m1.effective_mode, 'ro')
    assert.equal(m1.mount_path, `/data/rns/r__${w1}`)
    assert.ok(!svc.leases.writer(w1))
    assert.equal(svc.leases.writer(w2)?.holder.id, s.id)
    assert.equal(pub.mounts.find((m) => m.workspace_id === w2)!.mount_path, `/data/rns/r__${w2}`)
    await ready(s.id)
    // another session takes w1 rw; we ask rw on busy workspace -> degraded with notice
    const other = await create(admin, [{ workspace_id: w1, mount_mode: 'rw' }])
    pub = await put([{ workspace_id: w1, mount_mode: 'rw' }])
    assert.equal(pub.mounts[0]!.effective_mode, 'ro')
    assert.equal(pub.notices.length, 1)
    assert.equal(svc.leases.list(w2).length, 0)
    await ready(s.id)
    await sessions.destroyDesktopSession(admin as never, 'session', other.id)
    // on-demand workspace
    pub = await put([{ new_workspace: { namespace: 'rns', repo: 'r', name: 'edit-new', source: { branch: 'main' } }, mount_mode: 'rw' }])
    assert.equal(pub.mounts.length, 1)
    assert.equal(svc.getState(pub.mounts[0]!.workspace_id!)!.name, 'edit-new')
    assert.equal(svc.leases.list(w1).length, 0)
    await ready(s.id)
    assert.equal((await mountOf(s.id)).effective_mode, 'rw')
    // empty list = desktop only
    pub = await put([])
    assert.deepEqual(pub.mounts, [])
    assert.equal(svc.leases.list(w1).length + svc.leases.list(w2).length, 0)
    const ev = (await queryAudit({ action: 'session.mounts.update' })).events.filter((e) => (e.detail as { session_id?: string })?.session_id === s.id)
    assert.ok(ev.length >= 4)
    const d = ev.find((e) => (e.detail as { before: unknown[] }).before.length === 1 && (e.detail as { after: unknown[] }).after.length === 2)
    assert.ok(d)
    await ready(s.id)
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
  })

  await it('PUT mounts: validation, state and authz guards', async () => {
    const w = await mkWs()
    const s = await create(admin, [])
    const put = (u: unknown, mounts: unknown[]) => {
      const parsed = sessions.parseMountsList(mounts)
      if ('error' in parsed) return Promise.reject(Object.assign(new Error(parsed.error), { status: 400 }))
      return sessions.updateSessionMounts(u as never, 'session', s.id, parsed)
    }
    const status = (e: unknown) => (e as { status?: number }).status
    await ready(s.id)
    await updateSession(s.id, { status: 'provisioning' })
    await assert.rejects(put(admin, [{ workspace_id: w }]), (e) => status(e) === 409) // not ready for mount edits
    await updateSession(s.id, { status: 'ready' })
    await assert.rejects(put(admin, [{ workspace_id: w, pin_commit: 'abc' }]), (e) => status(e) === 400)
    await assert.rejects(put(admin, [{ namespace: 'rns', repo: 'r' }]), (e) => status(e) === 400)
    await assert.rejects(put(admin, [{ workspace_id: w }, { workspace_id: w }]), (e) => status(e) === 400)
    await assert.rejects(put(admin, Array.from({ length: 9 }, (_, i) => ({ workspace_id: `w_abcdefghi${i}` }))), (e) => status(e) === 400)
    await assert.rejects(put(admin, [{ workspace_id: 'w_zzzzzzzzzz' }]), (e) => status(e) === 404)
    // User (not Manager) is denied editing someone else's session; Manager has session.admin.
    await assert.rejects(put(other, [{ workspace_id: w, mount_mode: 'ro' }]), (e) => status(e) === 403)
    // Namespace member with read-only repo access cannot create a new workspace via remount.
    const rs = await create(reader, [{ workspace_id: w, mount_mode: 'ro' }])
    await ready(rs.id)
    const before = svc.list({ namespace: 'rns', repo: 'r' }).length
    await assert.rejects(
      sessions.updateSessionMounts(reader as never, 'session', rs.id, [
        { new_workspace: { namespace: 'rns', repo: 'r', source: { branch: 'main' } } },
      ]),
      (e) => status(e) === 403,
    )
    assert.equal(svc.list({ namespace: 'rns', repo: 'r' }).length, before)
    assert.equal((await getSessionRecord(rs.id))!.status, 'ready')
    await sessions.destroyDesktopSession(reader as never, 'session', rs.id)
    assert.equal((await getSessionRecord(s.id))!.status, 'ready')
    await sessions.destroyDesktopSession(admin as never, 'session', s.id)
  })

  await it('docker args: ro/rw volumes, nocopy, tamper check', async () => {
    const w = await mkWs()
    const a = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    const b = await create(admin, [{ workspace_id: w, mount_mode: 'ro' }])
    const ra = await sw.workspaceDockerMounts((await getSessionRecord(a.id))!)
    assert.equal(ra.args[0], '--mount')
    assert.match(ra.args[1]!, /^type=volume,source=mice-ws-w_[0-9a-z]{10}-g\d+,target=\/data\/rns\/r__w_[0-9a-z]{10},volume-nocopy$/)
    assert.ok(ra.env.includes('UMASK=002'))
    assert.ok(ra.env.includes(`PUID=${cfg.uid}`))
    assert.ok(ra.env.includes(`PGID=${cfg.gid}`))
    const rb = await sw.workspaceDockerMounts((await getSessionRecord(b.id))!)
    assert.ok(rb.args[1]!.endsWith(',readonly'))

    const upper = join(svc.dir(w), 'upper')
    mkdirSync(upper, { recursive: true })
    writeFileSync(join(upper, 'sneaky.txt'), 'x')
    await assert.rejects(
      sw.workspaceDockerMounts((await getSessionRecord(a.id))!),
      (e: unknown) => e instanceof sw.SessionWorkspaceError && /tamper/.test(e.message),
    )
    for (const s of [a, b]) {
      await ready(s.id)
      await sessions.destroyDesktopSession(admin as never, 'session', s.id)
    }
  })

  await it('reconciliation releases leases of terminal sessions; renewer extends live ones', async () => {
    const w = await mkWs()
    const s = await create(admin, [{ workspace_id: w, mount_mode: 'rw' }])
    await ready(s.id)
    const lid = (await mountOf(s.id)).lease_id!
    const before = Date.parse(svc.leases.get(lid)!.expires_at)
    await new Promise((r) => setTimeout(r, 15))
    await sw.renewSessionLeases()
    assert.ok(Date.parse(svc.leases.get(lid)!.expires_at) > before)
    await updateSession(s.id, { status: 'failed' })
    await svc.reconcileLeases()
    assert.equal(svc.leases.list(w).length, 0)
  })
})
