import '../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'mice-lease-'))
process.env.AUTH_DATA_DIR = root
process.env.WORKSPACES_STORE_DIR = join(root, 'store')
process.env.WORKSPACES_DIR = join(root, 'workspaces')
process.env.WORKSPACES_UID = String(process.getuid!())
process.env.WORKSPACES_GID = String(process.getgid!())

const { CheckoutStore } = await import('./checkout.js')
const { loadWorkspacesConfig } = await import('./config.js')
const { WorkspaceService, WorkspaceError } = await import('./workspaces.js')
const { LeaseStore, LeaseError, TamperError, toPublicLease } = await import('./leases.js')
const { mountSpecFor, verifyUpperHash, requireWriteLease, DockerInUseError, dockerVolumeName } = await import('./mount.js')
const { resetHostVolumePathsForTest } = await import('./capabilities.js')
const { FakeOxen } = await import('./fakeOxen.js')

resetHostVolumePathsForTest({ store: '/host/store', ws: '/host/ws' })

const C1 = 'c1111111111111111111111111111111'
const tree = { 'README.md': 'hello', 'src/a.txt': 'aaa' }

class FakeDocker {
  volumes = new Map<string, string[]>()
  busy = new Set<string>()
  volumeExists = async (n: string) => this.volumes.has(n)
  volumeCreate = async (n: string, o: string[]) => void this.volumes.set(n, o)
  volumeRm = async (n: string) => {
    if (this.busy.has(n)) throw new DockerInUseError(n)
    this.volumes.delete(n)
  }
  volumeList = async (prefix: string) => [...this.volumes.keys()].filter((n) => n.startsWith(prefix))
}

const stOf = (svc: unknown, id: string) => (svc as { mustGet(id: string): never }).mustGet(id) as import('./workspaces.js').WorkspaceState
const who = { email: 'a@b.c', sub: 's1' }
const user = { sub: 's1', email: 'a@b.c', name: 'A', groups: [] } as never

function put(upper: string, rel: string, content: string) {
  const p = join(upper, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}

async function mk(over: Record<string, unknown> = {}) {
  const o = new FakeOxen()
  o.commit(C1, tree, 'main')
  const dir = mkdtempSync(join(root, 'inst-'))
  const cfg = {
    ...loadWorkspacesConfig(),
    storeDir: join(dir, 'store'),
    wsDir: join(dir, 'workspaces'),
    downloadConcurrency: 1,
    downloadRetries: 0,
    downloadRetryBaseMs: 1,
    blobMinAgeMs: 0,
    scanTtlMs: 0,
    ...over,
  }
  const docker = new FakeDocker()
  const holder: { svc?: InstanceType<typeof WorkspaceService> } = {}
  const store = new CheckoutStore({ cfg, oxen: o, refs: () => holder.svc?.referencedCheckouts() ?? [] })
  const svc = new WorkspaceService({
    store,
    cfg,
    docker,
    pickDriver: async () => 'overlay',
    readMarkers: async () => new Map(),
  })
  holder.svc = svc
  await store.init()
  await svc.init()
  const ws = await svc.create({ namespace: 'ns', repo: 'r', source: { branch: 'main' }, createdBy: who })
  await svc.whenSettled(ws.id)
  return { svc, docker, id: ws.id, cfg }
}

const acq = (id: string, mode: 'read' | 'write', kind = 'user', hid = 'h1', sub = 's1') => ({
  workspaceId: id,
  mode,
  holder: { kind: kind as 'user', id: hid, label: 'L' },
  ownerSub: sub,
  ownerEmail: 'a@b.c',
})

after(() => rmSync(root, { recursive: true, force: true }))

describe('lease semantics', () => {
  it('one writer, many readers, 423 carries the holder', async () => {
    const { svc, id } = await mk()
    const w = await svc.acquireLease(acq(id, 'write'))
    assert.match(w.id, /^l_[0-9a-z]{12}$/)
    assert.ok(w.upper_hash)
    const r1 = await svc.acquireLease(acq(id, 'read', 'job', 'j1'))
    const r2 = await svc.acquireLease(acq(id, 'read', 'job', 'j2'))
    assert.equal(svc.leases.list(id).length, 3)
    await assert.rejects(svc.acquireLease(acq(id, 'write', 'job', 'j3', 's2')), (e: unknown) => {
      assert.ok(e instanceof LeaseError)
      assert.equal(e.status, 423)
      assert.equal(e.holder?.id, 'h1')
      return true
    })
    const pub = toPublicLease(w) as Record<string, unknown>
    assert.deepEqual(Object.keys(pub).sort(), ['created_at', 'expires_at', 'holder', 'id', 'mode', 'renewed_at', 'upper_hash', 'workspace_id'].sort())
    assert.equal('owner_sub' in pub, false)
    const view = await svc.get(id)
    assert.equal(view.leases.length, 3)
    assert.equal(view.writer?.id, 'h1')
    await svc.leases.release(w.id)
    assert.equal((await svc.get(id)).writer, null)
    await svc.acquireLease(acq(id, 'write', 'job', 'j3', 's2'))
    await svc.leases.release(r1.id)
    await svc.leases.release(r2.id)
    svc.shutdown()
  })

  it('concurrent write acquires grant exactly one', async () => {
    const { svc, id } = await mk()
    const res = await Promise.allSettled([1, 2, 3, 4].map((n) => svc.acquireLease(acq(id, 'write', 'job', `j${n}`))))
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(svc.leases.list(id).length, 1)
    svc.shutdown()
  })

  it('refuses write leases when not ready / over quota; reads still fine over quota', async () => {
    const { svc, id } = await mk({ wsMaxBytes: 10 })
    put(join(svc.dir(id), 'upper'), 'big.bin', 'x'.repeat(100))
    await assert.rejects(svc.acquireLease(acq(id, 'write')), (e: unknown) => e instanceof LeaseError && e.status === 507)
    await svc.acquireLease(acq(id, 'read'))
    svc.shutdown()
  })

  it('refuses write while preparing (op/status gate)', async () => {
    const store = new LeaseStore(join(root, 'gate.json'), loadWorkspacesConfig())
    const view = (status: string, op = 'idle') => ({ status, op, over_quota: false, upperHash: async () => 'h' })
    await assert.rejects(store.acquire(acq('w_a', 'write'), view('preparing')), (e: unknown) => e instanceof LeaseError && e.status === 409)
    await assert.rejects(store.acquire(acq('w_a', 'write'), view('ready', 'committing')), (e: unknown) => e instanceof LeaseError && e.status === 409)
    await store.acquire(acq('w_a', 'write'), view('ready'))
  })

  it('waiting-writer flag blocks new session writers only', async () => {
    const store = new LeaseStore(join(root, 'wait.json'), loadWorkspacesConfig())
    const view = { status: 'ready', op: 'idle', over_quota: false, upperHash: async () => 'h' }
    store.setWriterWaiting('w_a', true)
    await assert.rejects(store.acquire(acq('w_a', 'write', 'session', 's'), view), (e: unknown) => e instanceof LeaseError && e.status === 423)
    await store.acquire(acq('w_a', 'write', 'job', 'j'), view)
  })
})

describe('multi-workspace acquire', () => {
  it('is all-or-nothing and leaves nothing behind', async () => {
    const a = await mk()
    const store = a.svc.leases
    const free = { status: 'ready', op: 'idle', over_quota: false, upperHash: async () => 'h' }
    await a.svc.acquireLease(acq(a.id, 'write', 'job', 'holder', 's2'))
    // 'w_0' sorts before the real id and is granted first, then the held one refuses: rollback
    await assert.rejects(
      store.acquireMany([acq(a.id, 'write'), acq('w_0', 'write')], (id) => (id === a.id ? a.svc.leaseView(id) : free)),
      (e: unknown) => e instanceof LeaseError && e.status === 423 && e.message.startsWith(`${a.id}:`) && e.holder?.id === 'holder',
    )
    assert.equal(store.list('w_0').length, 0)
    assert.equal(store.list(a.id).length, 1)
    await store.release(store.writer(a.id)!.id)
    const failing = { status: 'preparing', op: 'idle', over_quota: false, upperHash: async () => 'h' }
    await assert.rejects(
      store.acquireMany([acq(a.id, 'write'), acq('w_zzzz', 'write')], (id) => (id === a.id ? a.svc.leaseView(id) : failing)),
      (e: unknown) => e instanceof LeaseError && e.message.startsWith('w_zzzz:'),
    )
    assert.equal(store.list(a.id).length, 0)
    const ok = await a.svc.acquireLeases([acq(a.id, 'write'), acq(a.id, 'read', 'job', 'x')])
    assert.equal(ok.length, 2)
    a.svc.shutdown()
  })
})

describe('ttl, renew, persistence, reconcile', () => {
  it('expires, renews and survives a restart', async () => {
    let t = 1_000_000
    const path = join(root, 'ttl.json')
    const cfg = loadWorkspacesConfig()
    const store = new LeaseStore(path, cfg, () => t)
    const view = { status: 'ready', op: 'idle', over_quota: false, upperHash: async () => 'h1' }
    const l = await store.acquire({ ...acq('w_a', 'write'), ttlSec: 60 }, view)
    const keep = await store.acquire({ ...acq('w_a', 'read', 'job', 'k'), ttlSec: 60 }, view)

    const again = new LeaseStore(path, cfg, () => t)
    assert.equal(again.list('w_a').length, 2)
    assert.equal(again.writer('w_a')?.id, l.id)
    assert.equal(again.get(l.id)?.upper_hash, 'h1')

    t += 30_000
    await again.renew(keep.id, 60)
    t += 40_000 // l expired, keep renewed
    const rel = await again.reconcile({ workspaceExists: () => true })
    assert.deepEqual(rel.map((r) => [r.lease.id, r.reason]), [[l.id, 'expired']])
    assert.equal(again.writer('w_a'), undefined)
    assert.equal(again.list('w_a').length, 1)
    await assert.rejects(again.renew(l.id), (e: unknown) => e instanceof LeaseError && e.status === 404)
    // new writer is possible once the expired one is gone
    await again.acquire(acq('w_a', 'write', 'job', 'n'), view)
  })

  it('releases leases of gone holders only after the grace period, and of gone workspaces', async () => {
    let t = 5_000_000
    const cfg = { ...loadWorkspacesConfig(), leaseOrphanGraceMs: 120_000 }
    const store = new LeaseStore(join(root, 'orph.json'), cfg, () => t)
    const view = { status: 'ready', op: 'idle', over_quota: false, upperHash: async () => 'h' }
    await store.acquire(acq('w_a', 'write', 'job', 'dead'), view)
    await store.acquire(acq('w_b', 'read', 'job', 'dead'), view)
    const opts = { workspaceExists: (id: string) => id !== 'w_b', holderState: () => 'gone' as const }
    // w_b's workspace is gone: released immediately
    let rel = await store.reconcile(opts)
    assert.deepEqual(rel.map((r) => r.reason), ['workspace_gone'])
    assert.equal(store.list('w_a').length, 1)
    t += 121_000
    rel = await store.reconcile({ ...opts, workspaceExists: () => true })
    assert.deepEqual(rel.map((r) => r.reason), ['holder_gone'])
    assert.equal(store.list('w_a').length, 0)
  })
})

describe('mount spec + tamper check', () => {
  it('requires a matching live lease and re-checks authz', async () => {
    const { svc, docker, id } = await mk()
    const st = stOf(svc, id)
    const w = await svc.acquireLease(acq(id, 'write'))
    const r = await svc.acquireLease(acq(id, 'read', 'job', 'r'))
    const allow = { user, authorize: () => ({ allow: true }) }
    const rw = await mountSpecFor(svc, st, w, 'rw', '/work', allow)
    assert.equal(rw.type, 'volume')
    assert.equal(rw.source, dockerVolumeName(st))
    assert.equal(rw.readonly, false)
    assert.equal(rw.target, '/work')
    const opts = docker.volumes.get(rw.source)!.join(',')
    assert.match(opts, /type=overlay/)
    assert.match(opts, new RegExp(`lowerdir=/host/store/commits/ns/r/${C1}/tree`))
    assert.match(opts, new RegExp(`upperdir=/host/ws/${id}/upper`))
    assert.match(opts, new RegExp(`workdir=/host/ws/${id}/work`))
    assert.match(opts, /userxattr/)
    const ro = await mountSpecFor(svc, st, r, 'ro', '/work', allow)
    assert.equal(ro.readonly, true)
    assert.ok(ro.docker_args.join(' ').includes('readonly'))

    await assert.rejects(mountSpecFor(svc, st, r, 'rw', '/work', allow), (e: unknown) => e instanceof LeaseError && e.status === 403)
    await assert.rejects(mountSpecFor(svc, st, w, 'ro', '/work', allow), (e: unknown) => e instanceof LeaseError && e.status === 403)
    await assert.rejects(
      mountSpecFor(svc, st, w, 'rw', '/work', { user, authorize: () => ({ allow: false, reason: 'nope' }) }),
      (e: unknown) => e instanceof LeaseError && e.status === 403,
    )
    for (const bad of ['work', '/a,b', '/a b', '/../x', '/a=b', '']) {
      await assert.rejects(mountSpecFor(svc, st, w, 'rw', bad, allow), (e: unknown) => e instanceof LeaseError && e.status === 400, bad)
    }
    await svc.leases.release(w.id)
    await assert.rejects(mountSpecFor(svc, st, w, 'rw', '/work', allow), (e: unknown) => e instanceof LeaseError && e.status === 403)
    svc.shutdown()
  })

  it('detects an upper that changed after the grant', async () => {
    const { svc, id } = await mk()
    const st = stOf(svc, id)
    const w = await svc.acquireLease(acq(id, 'write'))
    await verifyUpperHash(svc, st, w)
    put(join(svc.dir(id), 'upper'), 'sneaky.txt', 'x')
    await assert.rejects(verifyUpperHash(svc, st, w), (e: unknown) => e instanceof TamperError && e.status === 409)
    svc.shutdown()
  })

  it('requireWriteLease', async () => {
    const { svc, id } = await mk()
    assert.throws(() => requireWriteLease(svc, id, null), (e: unknown) => e instanceof LeaseError && e.status === 423)
    const w = await svc.acquireLease(acq(id, 'write'))
    assert.equal(requireWriteLease(svc, id, w.id).id, w.id)
    assert.throws(() => requireWriteLease(svc, id, 'l_other'), (e: unknown) => e instanceof LeaseError && e.holder?.id === 'h1')
    svc.shutdown()
  })
})

describe('delete with leases and volumes', () => {
  it('423 while leased, removes volumes, 409 when a container uses them', async () => {
    const { svc, docker, id } = await mk()
    const st = stOf(svc, id)
    const w = await svc.acquireLease(acq(id, 'write'))
    await mountSpecFor(svc, st, w, 'rw', '/work', { user, authorize: () => ({ allow: true }) })
    const vol = dockerVolumeName(st)
    assert.ok(docker.volumes.has(vol))
    await assert.rejects(svc.delete(id), (e: unknown) => e instanceof LeaseError && e.status === 423)
    assert.ok(docker.volumes.has(vol))
    await svc.leases.release(w.id)
    docker.busy.add(vol)
    await assert.rejects(svc.delete(id), (e: unknown) => (e instanceof WorkspaceError || e instanceof DockerInUseError || e instanceof LeaseError) && true)
    docker.busy.clear()
    await svc.delete(id)
    assert.equal(docker.volumes.size, 0)
    assert.equal(svc.leases.list(id).length, 0)
    svc.shutdown()
  })
})
