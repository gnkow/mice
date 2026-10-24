import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'mice-ws-'))
process.env.AUTH_DATA_DIR = root
process.env.WORKSPACES_STORE_DIR = join(root, 'store')
process.env.WORKSPACES_DIR = join(root, 'workspaces')
process.env.WORKSPACES_UID = String(process.getuid!())
process.env.WORKSPACES_GID = String(process.getgid!())

const { CheckoutStore } = await import('./checkout.js')
const { loadWorkspacesConfig } = await import('./config.js')
const { WorkspaceService, WorkspaceError, validWorkspaceId } = await import('./workspaces.js')
const { BaseIndex, scanUpper, parseGetfattr } = await import('./scan.js')
const { FakeOxen } = await import('./fakeOxen.js')
const { OxenError } = await import('./oxenClient.js')
const { openInside, PathError, cleanRelPath } = await import('./files.js')

const C1 = 'c1111111111111111111111111111111'
const tree = {
  'README.md': 'hello',
  'src/a.txt': 'aaa',
  'src/deep/b.txt': 'bbb',
  'docs/x.md': 'xxx',
  'docs/y.md': 'yyy',
}

const sha = (s: string) => import('node:crypto').then((c) => c.createHash('sha256').update(s).digest('hex'))
async function baseIdx() {
  const files = new Map<string, { size: number; sha256: string }>()
  for (const [p, c] of Object.entries(tree)) files.set(p, { size: Buffer.byteLength(c), sha256: await sha(c) })
  return new BaseIndex(files)
}

function put(upper: string, rel: string, content: string) {
  const p = join(upper, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}

async function until(fn: () => boolean, ms = 5000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function fakeDocker() {
  return {
    volumeExists: async () => false,
    volumeCreate: async () => undefined,
    volumeRm: async () => undefined,
    volumeList: async () => [] as string[],
  }
}

function mkSvc(oxen: InstanceType<typeof FakeOxen>, over: Record<string, unknown> = {}) {
  const cfg = { ...loadWorkspacesConfig(), downloadConcurrency: 1, downloadRetries: 0, downloadRetryBaseMs: 1, blobMinAgeMs: 0, scanTtlMs: 0, ...over }
  const holder: { svc?: InstanceType<typeof WorkspaceService> } = {}
  const store = new CheckoutStore({ cfg, oxen, refs: () => holder.svc?.referencedCheckouts() ?? [] })
  const svc = new WorkspaceService({ store, cfg, pickDriver: async () => 'overlay', docker: fakeDocker(), readMarkers: async () => new Map() })
  holder.svc = svc
  return { svc, store, cfg }
}

const who = { email: 'a@b.c', sub: 's1' }

after(() => rmSync(root, { recursive: true, force: true }))

describe('scanUpper', () => {

  it('reports added / modified / unchanged copy-up', async () => {
    const upper = mkdtempSync(join(root, 'up-'))
    put(upper, 'README.md', 'hello') // copy-up without change
    put(upper, 'src/a.txt', 'CHANGED')
    put(upper, 'new/n.txt', 'n')
    const r = await scanUpper({ upper, base: await baseIdx(), readMarkers: async () => new Map() })
    assert.deepEqual(r.added.map((x) => x.path), ['new/n.txt'])
    assert.deepEqual(r.modified.map((x) => x.path), ['src/a.txt'])
    assert.equal(r.removed.length, 0)
    assert.equal(r.files, 3)
  })

  it('whiteout markers remove a file and a whole directory', async () => {
    const upper = mkdtempSync(join(root, 'up-'))
    put(upper, 'src/a.txt', '')
    put(upper, 'docs', '')
    const markers = async () =>
      new Map([
        ['src/a.txt', new Map([['user.overlay.whiteout', '']])],
        ['docs', new Map([['user.overlay.whiteout', '']])],
      ])
    const r = await scanUpper({ upper, base: await baseIdx(), readMarkers: markers })
    assert.deepEqual(r.removed.map((x) => x.path), ['docs/x.md', 'docs/y.md', 'src/a.txt'])
    assert.equal(r.added.length + r.modified.length, 0)
  })

  it('opaque directory hides lower files not present in upper', async () => {
    const upper = mkdtempSync(join(root, 'up-'))
    put(upper, 'docs/x.md', 'xxx')
    put(upper, 'docs/z.md', 'zzz')
    const markers = async () => new Map([['docs', new Map([['user.overlay.opaque', '79']])]])
    const r = await scanUpper({ upper, base: await baseIdx(), readMarkers: markers })
    assert.deepEqual(r.removed.map((x) => x.path), ['docs/y.md'])
    assert.deepEqual(r.added.map((x) => x.path), ['docs/z.md'])
    assert.equal(r.modified.length, 0)
  })

  it('file replacing a lower directory removes everything under it', async () => {
    const upper = mkdtempSync(join(root, 'up-'))
    put(upper, 'src', 'now a file')
    const r = await scanUpper({ upper, base: await baseIdx(), readMarkers: async () => new Map() })
    assert.deepEqual(r.removed.map((x) => x.path), ['src/a.txt', 'src/deep/b.txt'])
    assert.deepEqual(r.added.map((x) => x.path), ['src'])
  })

  it('unreadable markers produce a warning, symlinks are special and never followed', async () => {
    const upper = mkdtempSync(join(root, 'up-'))
    put(upper, 'src/a.txt', 'aaa')
    symlinkSync('/etc/passwd', join(upper, 'evil'))
    const r = await scanUpper({ upper, base: await baseIdx(), readMarkers: async () => null })
    assert.equal(r.warnings.length, 1)
    assert.deepEqual(r.special, [{ path: 'evil', kind: 'symlink' }])
    assert.ok(!r.entries.has('evil'))
  })

  it('parses getfattr output including escaped names', () => {
    const out = [
      '# file: up/d',
      'user.overlay.opaque="y"'.replace('"y"', '=0x79').replace('==', '='),
      '',
      '# file: "up/we\\040ird"',
      'user.overlay.whiteout',
      '',
    ].join('\n')
    const m = parseGetfattr(out, 'up')
    assert.equal(m.get('d')?.get('user.overlay.opaque'), '79')
    assert.ok(m.get('we ird')?.has('user.overlay.whiteout'))
  })
})

describe('path safety', () => {
  it('rejects traversal and .oxen', () => {
    for (const p of ['../etc/passwd', 'a/../b', 'a\\b', '.oxen/config', 'a\0b']) assert.throws(() => cleanRelPath(p), PathError)
    assert.equal(cleanRelPath('/a//b/'), 'a/b')
  })

  it('openInside refuses symlinked files and directories', async () => {
    const dir = mkdtempSync(join(root, 'sym-'))
    put(dir, 'ok.txt', 'ok')
    symlinkSync('/etc', join(dir, 'etc'))
    symlinkSync('/etc/passwd', join(dir, 'pw'))
    const f = await openInside(dir, 'ok.txt')
    assert.equal(f.size, 2)
    f.stream.destroy()
    await assert.rejects(openInside(dir, 'pw'))
    await assert.rejects(openInside(dir, 'etc/passwd'))
    await assert.rejects(openInside(dir, '../x'))
  })
})

describe('workspace service', () => {
  it('unnamed workspaces are unique alongside named workspaces on the same source', async () => {
    const o = new FakeOxen()
    const branch = 'feature/' + 'long-branch'.repeat(8)
    o.commit(C1, tree, branch)
    const { svc, store } = mkSvc(o, { storeDir: join(root, 'names-store'), wsDir: join(root, 'names-workspaces') })
    await store.init()
    await svc.init()
    try {
      const input = { namespace: 'ns', repo: 'names', source: { branch }, createdBy: who }
      const named = await svc.create({ ...input, name: 'mine' })
      const unnamed = await Promise.all([svc.create(input), svc.create({ ...input, name: '  ' })])
      for (const ws of [named, ...unnamed]) await svc.whenSettled(ws.id)
      assert.equal(svc.getState(named.id)!.name, 'mine')
      for (const ws of unnamed) {
        const name = svc.getState(ws.id)!.name
        assert.ok(name.startsWith(`${ws.id}-feature-`))
        assert.ok(name.endsWith(`-${C1.slice(0, 8)}`))
        assert.ok(name.length <= 64)
      }
      assert.notEqual(svc.getState(unnamed[0]!.id)!.name, svc.getState(unnamed[1]!.id)!.name)
      const commit = await svc.create({ ...input, source: { commit: C1 } })
      await svc.whenSettled(commit.id)
      assert.equal(svc.getState(commit.id)!.name, `${commit.id}-commit-${C1.slice(0, 8)}`)
      const concurrent = await Promise.allSettled([
        svc.create({ ...input, name: 'concurrent' }),
        svc.create({ ...input, name: 'CONCURRENT' }),
      ])
      assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1)
      for (const r of concurrent) {
        if (r.status === 'fulfilled') await svc.whenSettled(r.value.id)
        else assert.equal(r.reason.status, 409)
      }
    } finally {
      svc.shutdown()
    }
  })

  it('write permissions cover overlay lower/upper and copy/reflink trees without changing contents', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    const { svc, store } = mkSvc(o, { storeDir: join(root, 'permissions-store'), wsDir: join(root, 'permissions-workspaces') })
    await store.init()
    await svc.init()
    try {
      const ws = await svc.create({ namespace: 'ns', repo: 'permissions', source: { branch: 'main' }, createdBy: who })
      const st = await svc.whenSettled(ws.id)
      const lower = store.treeDir(st.namespace, st.repo, C1)
      const lowerFile = join(lower, 'src/a.txt')
      const inode = statSync(lowerFile).ino
      chmodSync(lowerFile, 0o444)
      chmodSync(join(lower, 'src'), 0o555)
      await svc.prepareWritePermissions(st)
      assert.equal(statSync(lowerFile).ino, inode)
      assert.equal(readFileSync(lowerFile, 'utf8'), 'aaa')
      assert.ok(statSync(lowerFile).mode & 0o200)
      assert.ok(statSync(join(lower, 'src')).mode & 0o200)
      assert.equal(statSync(join(svc.dir(ws.id), 'upper')).uid, svc.cfg.uid)
      const plain = join(svc.dir(ws.id), 'tree')
      put(plain, 'nested/a.txt', 'plain')
      chmodSync(join(plain, 'nested/a.txt'), 0o444)
      for (const driver of ['copy', 'reflink'] as const) {
        await svc.prepareWritePermissions({ ...st, driver })
        assert.ok(statSync(join(plain, 'nested/a.txt')).mode & 0o200)
        assert.equal(readFileSync(join(plain, 'nested/a.txt'), 'utf8'), 'plain')
      }
    } finally {
      svc.shutdown()
    }
  })

  it('create → preparing → ready → files/changes → delete', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    const { svc, store } = mkSvc(o)
    await store.init()
    await svc.init()
    const ws = await svc.create({ namespace: 'ns', repo: 'r', source: { branch: 'main' }, createdBy: who })
    assert.equal(ws.status, 'preparing')
    assert.ok(validWorkspaceId(ws.id))
    assert.equal(ws.driver, 'overlay')
    const st = await svc.whenSettled(ws.id)
    assert.equal(st.status, 'ready')
    const pub = await svc.get(ws.id)
    assert.deepEqual(
      Object.keys(pub).sort(),
      ['id', 'kind', 'name', 'namespace', 'repo', 'branch', 'base_commit', 'lower_commit',
      'mountable_modes', 'status', 'op', 'last_error', 'progress', 'upper_bytes', 'change_counts', 'quota_bytes', 'driver', 'behind', 'over_quota', 'next_retry_at', 'created_by', 'created_at', 'updated_at', 'leases', 'writer', 'session_count'].sort(),
    )
    assert.equal(pub.base_commit, C1)
    assert.equal(pub.behind, false)
    assert.ok(existsSync(join(svc.dir(ws.id), 'upper')))
    const empty = await svc.changes(ws.id)
    assert.deepEqual([empty.added, empty.modified, empty.removed], [[], [], []])

    // directory listing and file read from the lower checkout
    const root1 = await svc.readPath(ws.id, '')
    assert.equal(root1.kind, 'dir')
    if (root1.kind === 'dir') assert.deepEqual(root1.entries.map((e) => e.name).sort(), ['README.md', 'docs', 'src'])
    const f = await svc.readPath(ws.id, 'src/a.txt')
    assert.equal(f.kind, 'file')
    if (f.kind === 'file') f.file.stream.destroy()

    // upper overlays the lower
    const upper = join(svc.dir(ws.id), 'upper')
    put(upper, 'src/a.txt', 'CHANGED')
    put(upper, 'added.txt', 'new')
    const ch = await svc.changes(ws.id)
    assert.deepEqual(ch.modified.map((x) => x.path), ['src/a.txt'])
    assert.deepEqual(ch.added.map((x) => x.path), ['added.txt'])
    assert.equal((await svc.get(ws.id)).change_counts.added, 1)
    const eff = await svc.readPath(ws.id, 'src')
    if (eff.kind === 'dir') assert.equal(eff.entries.find((e) => e.name === 'a.txt')?.source, 'upper')

    // traversal
    await assert.rejects(svc.readPath(ws.id, '../../etc/passwd'), PathError)
    await assert.rejects(svc.readPath(ws.id, '.oxen/x'), PathError)
    await assert.rejects(svc.readPath(ws.id, 'nope.txt'), PathError)

    // archive contains the effective tree
    let bytes = 0
    for await (const b of await svc.archive(ws.id)) bytes += b.length
    assert.ok(bytes > 512 * 5)

    assert.ok(svc.referencedCheckouts().has(`ns/r/${C1}`))
    await svc.delete(ws.id)
    assert.ok(!existsSync(svc.dir(ws.id)))
    assert.equal(svc.list({ namespace: 'ns', repo: 'r' }).length, 0)
    assert.equal(svc.referencedCheckouts().size, 0)
    await assert.rejects(svc.get(ws.id), (e: unknown) => e instanceof WorkspaceError && e.status === 404)
    svc.shutdown()
  })

  it('duplicate names → 409; invalid input → 400', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    const { svc, store } = mkSvc(o)
    await store.init()
    await svc.init()
    const a = await svc.create({ namespace: 'ns', repo: 'dup', name: 'mine', source: { branch: 'main' }, createdBy: who })
    await assert.rejects(svc.create({ namespace: 'ns', repo: 'dup', name: 'MINE', source: { branch: 'main' }, createdBy: who }), (e: unknown) => (e as { status: number }).status === 409)
    await assert.rejects(svc.create({ namespace: '../x', repo: 'r', source: { branch: 'main' }, createdBy: who }), (e: unknown) => (e as { status: number }).status === 400)
    await assert.rejects(svc.create({ namespace: 'ns', repo: 'r', name: '../../x', source: { branch: 'main' }, createdBy: who }), (e: unknown) => (e as { status: number }).status === 400)
    await svc.whenSettled(a.id)
    svc.shutdown()
  })

  it('unknown branch → error; retry after it appears → ready', async () => {
    const o = new FakeOxen()
    const { svc, store } = mkSvc(o)
    await store.init()
    await svc.init()
    const ws = await svc.create({ namespace: 'ns', repo: 'e1', source: { branch: 'later' }, createdBy: who })
    const st = await svc.whenSettled(ws.id)
    assert.equal(st.status, 'error')
    assert.match(st.last_error ?? '', /not found/)
    o.commit(C1, tree, 'later')
    await svc.retry(ws.id)
    assert.equal((await svc.whenSettled(ws.id)).status, 'ready')
    await assert.rejects(svc.retry(ws.id), (e: unknown) => (e as { status: number }).status === 409)
    svc.shutdown()
  })

  it('transient Oxen failure keeps status preparing with backoff, then succeeds', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    o.failAfterDownloads = 1
    const { svc, store } = mkSvc(o, { retryBackoffMs: [30] })
    await store.init()
    await svc.init()
    const ws = await svc.create({ namespace: 'ns', repo: 'tr', source: { branch: 'main' }, createdBy: who })
    await until(() => !!svc.getState(ws.id)?.last_error)
    const mid = svc.getState(ws.id)!
    assert.equal(mid.status, 'preparing')
    assert.ok(mid.next_retry_at)
    o.failAfterDownloads = null
    await until(() => svc.getState(ws.id)?.status === 'ready')
    assert.equal(svc.getState(ws.id)!.last_error, null)
    // 5 unique files total: the one fetched before the failure is not fetched again
    assert.equal(o.downloads.length, 5)
    svc.shutdown()
  })

  it('state survives a restart; preparing workspaces resume', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    const a = mkSvc(o)
    await a.store.init()
    await a.svc.init()
    const ws = await a.svc.create({ namespace: 'ns', repo: 'rs', source: { branch: 'main' }, createdBy: who })
    await a.svc.whenSettled(ws.id)
    a.svc.shutdown()
    const b = mkSvc(o)
    await b.svc.init()
    assert.equal(b.svc.list({ namespace: 'ns', repo: 'rs' })[0]?.status, 'ready')
    assert.equal(b.svc.list({ namespace: 'ns', repo: 'rs' })[0]?.id, ws.id)
    b.svc.shutdown()
  })

  it('GC never evicts a checkout referenced by a workspace', async () => {
    const o = new FakeOxen()
    o.commit(C1, tree, 'main')
    const { svc, store } = mkSvc(o, { keepPerRepo: 0, ttlDays: 0 })
    await store.init()
    await svc.init()
    const ws = await svc.create({ namespace: 'ns', repo: 'gc', source: { branch: 'main' }, createdBy: who })
    await svc.whenSettled(ws.id)
    const { runGc } = await import('./checkoutMaintenance.js')
    const rep = await runGc(store)
    assert.ok(!rep.evicted.includes(`ns/gc/${C1}`))
    await svc.delete(ws.id)
    assert.ok((await runGc(store)).evicted.includes(`ns/gc/${C1}`))
    svc.shutdown()
  })

  it('error classification: OxenError retryable flag is respected', () => {
    assert.equal(new OxenError('x', 503, true).retryable, true)
  })
})
