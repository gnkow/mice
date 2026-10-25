import '../db/testSchema.js'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'mice-co-'))
process.env.AUTH_DATA_DIR = root
process.env.WORKSPACES_STORE_DIR = join(root, 'store')
process.env.WORKSPACES_DIR = join(root, 'workspaces')

const { CheckoutStore, StoreError, validateEntryName } = await import('./checkout.js')
const { loadWorkspacesConfig } = await import('./config.js')
const { listCheckouts, evictCheckout, runGc, runScrub, sweepTmp, checkoutStatus } = await import('./checkoutMaintenance.js')
const { FakeOxen } = await import('./fakeOxen.js')
const { OxenError } = await import('./oxenClient.js')

const C1 = 'c1111111111111111111111111111111'
const C2 = 'c2222222222222222222222222222222'
const C3 = 'c3333333333333333333333333333333'

function mk(oxen: InstanceType<typeof FakeOxen>, over: Partial<ReturnType<typeof loadWorkspacesConfig>> = {}, refs: string[] = []) {
  const cfg = { ...loadWorkspacesConfig(), downloadConcurrency: 1, downloadRetries: 0, downloadRetryBaseMs: 1, blobMinAgeMs: 0, ...over }
  const events: Array<{ action: string }> = []
  const store = new CheckoutStore({ cfg, oxen, audit: (e) => events.push(e), refs: () => refs })
  return { store, cfg, events }
}

const base = {
  'README.md': 'hello',
  'src/a.txt': 'aaa',
  'src/deep/b.txt': 'bbb',
  'docs/x.md': 'xxx',
  'dup1.txt': 'same',
  'dup2.txt': 'same',
}

describe('checkout store', () => {
  after(() => rmSync(root, { recursive: true, force: true }))
  beforeEach(() => {
    rmSync(join(root, 'store'), { recursive: true, force: true })
  })

  it('builds a correct tree, manifest and READY marker', async () => {
    const o = new FakeOxen()
    o.commit(C1, base, 'main')
    const { store } = mk(o)
    await store.init()
    const ref = await store.ensureCheckout('ns', 'r', 'main')
    assert.equal(ref.commit, C1)
    for (const [p, c] of Object.entries(base)) assert.equal(readFileSync(join(ref.tree, p), 'utf8'), c)
    assert.ok(existsSync(join(store.commitDir('ns', 'r', C1), 'READY')))
    const m = await store.loadManifest('ns', 'r', C1)
    assert.equal(m.files.size, 6)
    assert.equal(m.files.get('src/a.txt')?.sha256.length, 64)
    // identical content shares one blob (hardlink farm)
    assert.equal(statSync(join(ref.tree, 'dup1.txt')).ino, statSync(join(ref.tree, 'dup2.txt')).ino)
    assert.equal(o.downloads.length, 5)
    const list = await listCheckouts(store)
    assert.equal(list.length, 1)
    assert.equal(list[0]!.files, 6)
  })

  it('second ensure is a no-op fast path', async () => {
    const o = new FakeOxen()
    o.commit(C1, base)
    const { store } = mk(o)
    await store.init()
    await store.ensureCheckout('ns', 'r', C1)
    const n = o.downloads.length
    const l = o.listings.length
    await store.ensureCheckout('ns', 'r', C1)
    assert.equal(o.downloads.length, n)
    assert.equal(o.listings.length, l)
  })

  it('incremental: second commit downloads only the delta and prunes unchanged dirs', async () => {
    const o = new FakeOxen()
    o.commit(C1, base)
    o.commit(C2, { ...base, 'src/a.txt': 'CHANGED', 'new.txt': 'n' })
    const { store } = mk(o)
    await store.init()
    await store.ensureCheckout('ns', 'r', C1)
    o.downloads.length = 0
    o.listings.length = 0
    await store.ensureCheckout('ns', 'r', C2)
    assert.deepEqual(o.downloads.sort(), ['new.txt', 'src/a.txt'])
    // docs/ and src/deep/ are unchanged subtrees: never listed
    assert.ok(!o.listings.includes('docs'))
    assert.ok(!o.listings.includes('src/deep'))
    const meta = JSON.parse(readFileSync(join(store.commitDir('ns', 'r', C2), 'meta.json'), 'utf8'))
    assert.ok(meta.pruned_dirs >= 2)
    assert.equal(readFileSync(join(store.treeDir('ns', 'r', C2), 'src/a.txt'), 'utf8'), 'CHANGED')
    assert.equal(readFileSync(join(store.treeDir('ns', 'r', C1), 'src/a.txt'), 'utf8'), 'aaa')
  })

  it('resumes after a crash: durable blobs are not downloaded again', async () => {
    const o = new FakeOxen()
    o.commit(C1, base)
    const { store } = mk(o)
    await store.init()
    o.failAfterDownloads = 2
    await assert.rejects(store.ensureCheckout('ns', 'r', C1), (e: unknown) => e instanceof OxenError)
    assert.equal(o.downloads.length, 2)
    assert.ok(!existsSync(join(store.commitDir('ns', 'r', C1), 'READY')))
    // a "restarted" store instance with a healthy upstream
    o.failAfterDownloads = null
    o.downloads.length = 0
    const { store: store2 } = mk(o)
    await store2.init()
    await store2.ensureCheckout('ns', 'r', C1)
    assert.equal(o.downloads.length, 3) // 5 unique files - 2 already durable
    assert.equal(readFileSync(join(store2.treeDir('ns', 'r', C1), 'src/deep/b.txt'), 'utf8'), 'bbb')
  })

  it('single-flight: concurrent ensures share one build', async () => {
    const o = new FakeOxen()
    o.commit(C1, base, 'main')
    o.fileDelayMs = 5
    const { store } = mk(o)
    await store.init()
    const rs = await Promise.all([store.ensureCheckout('ns', 'r', 'main'), store.ensureCheckout('ns', 'r', C1), store.ensureCheckout('ns', 'r', 'main')])
    assert.equal(new Set(rs.map((r) => r.commit)).size, 1)
    assert.equal(o.downloads.length, 5)
  })

  it('rejects hostile names (..) and skips .oxen entries', () => {
    for (const bad of ['..', '.', '', 'a/b', 'a\\b', 'a\0b']) assert.throws(() => validateEntryName(bad), StoreError)
    validateEntryName('.oxenignore')
  })

  it('aborts the build on a listing containing ".."', async () => {
    const o = new FakeOxen()
    o.commit(C1, { 'a.txt': 'a' })
    o.rawRootEntries.set(C1, [{ name: '..', isDir: false, hash: 'abc', size: 1, dataType: 'text' }])
    const { store } = mk(o)
    await store.init()
    await assert.rejects(store.ensureCheckout('ns', 'r', C1), (e: unknown) => e instanceof StoreError && e.status === 422)
    assert.ok(!existsSync(join(store.commitDir('ns', 'r', C1), 'READY')))
    assert.ok(!existsSync(join(root, 'store', 'commits', 'ns', 'r', 'tree')))
  })

  it('skips .oxen internals but keeps .oxenignore', async () => {
    const o = new FakeOxen()
    o.commit(C1, { '.oxenignore': 'x', 'k.txt': 'k' })
    o.rawRootEntries.set(C1, [{ name: '.oxen', isDir: true, hash: 'abc', size: 0, dataType: 'dir' }])
    const { store } = mk(o)
    await store.init()
    const ref = await store.ensureCheckout('ns', 'r', C1)
    assert.deepEqual(readdirSync(ref.tree).sort(), ['.oxenignore', 'k.txt'])
  })

  it('rejects invalid namespace / ref', async () => {
    const { store } = mk(new FakeOxen())
    await store.init()
    await assert.rejects(store.ensureCheckout('../x', 'r', 'main'), StoreError)
    await assert.rejects(store.ensureCheckout('ns', 'r', 'a/../b'), StoreError)
  })

  it('GC: referenced checkouts are kept, keep-N evicts oldest, blobs are swept', async () => {
    const o = new FakeOxen()
    o.commit(C1, { 'a.txt': 'one' })
    o.commit(C2, { 'a.txt': 'two' })
    o.commit(C3, { 'a.txt': 'three' })
    const refs: string[] = []
    const { store, events } = mk(o, { keepPerRepo: 1, ttlDays: 0 }, refs)
    await store.init()
    for (const [c, age] of [[C1, 300], [C2, 200], [C3, 100]] as const) {
      await store.ensureCheckout('ns', 'r', c)
      const t = (Date.now() - age * 1000) / 1000
      utimesSync(join(store.commitDir('ns', 'r', c), 'READY'), t, t)
    }
    refs.push(`ns/r/${C1}`)
    assert.equal(await evictCheckout(store, 'ns', 'r', C1), 'referenced')
    const rep = await runGc(store, { reason: 'test' })
    const left = (await listCheckouts(store)).map((c) => c.commit).sort()
    // C1 referenced, C3 newest (keep 1); C2 evicted
    assert.deepEqual(left, [C1, C3])
    assert.deepEqual(rep.evicted, [`ns/r/${C2}`])
    assert.ok(rep.blobs_deleted >= 1)
    assert.ok(events.some((e) => e.action === 'checkout.evict'))
    refs.length = 0
    await runGc(store)
    assert.deepEqual((await listCheckouts(store)).map((c) => c.commit), [C3])
  })

  it('scrub quarantines checkouts with corrupted blobs', async () => {
    const o = new FakeOxen()
    o.commit(C1, { 'a.txt': 'one' })
    const { store } = mk(o)
    await store.init()
    const ref = await store.ensureCheckout('ns', 'r', C1)
    // corrupt in place (same inode as the blob)
    writeFileSync(join(ref.tree, 'a.txt'), 'ONE')
    const rep = await runScrub(store, { all: true })
    assert.equal(rep.bad.length, 1)
    const st = await checkoutStatus(store, 'ns', 'r', C1)
    assert.equal(st.status, 'corrupt')
  })

  it('startup sweep removes stale tmp builds but keeps fresh locked ones', async () => {
    const o = new FakeOxen()
    const { store } = mk(o)
    await store.init()
    const stale = join(root, 'store', 'tmp', 'old1')
    const fresh = join(root, 'store', 'tmp', 'new1')
    for (const d of [stale, fresh]) {
      await import('node:fs/promises').then((f) => f.mkdir(d, { recursive: true }))
      writeFileSync(join(d, 'lock'), '')
    }
    const old = (Date.now() - 3 * 24 * 3600 * 1000) / 1000
    utimesSync(join(stale, 'lock'), old, old)
    utimesSync(stale, old, old)
    await sweepTmp(store)
    assert.ok(!existsSync(stale))
    assert.ok(existsSync(fresh))
  })
})
