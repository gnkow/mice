import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createFileJsonBackend, createMemoryJsonBackend, useJsonBackend, writeText, type JsonBackend } from './jsonStore.js'
import { createSqliteBackend } from './sqliteBackend.js'
import { createAppendOnlyLog, createCollection, createDiskDocument, createDocumentStore, createJsonlLog } from './stores.js'

const adapters: Record<string, () => { dir: string; backend?: JsonBackend; cleanup(): void }> = {
  sqlite: () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-stores-sqlite-'))
    const backend = createSqliteBackend(join(dir, 'mice.db'))
    return { dir, backend, cleanup: () => { backend.close(); rmSync(dir, { recursive: true, force: true }) } }
  },
  file: () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-stores-'))
    return { dir, backend: createFileJsonBackend(), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  },
  memory: () => ({ dir: '/mem-stores', backend: createMemoryJsonBackend(), cleanup() {} }),
}

for (const [name, make] of Object.entries(adapters)) {
  const withAdapter = (fn: (dir: string, backend: JsonBackend | undefined) => void) => {
    const a = make()
    const restore = a.backend ? useJsonBackend(a.backend) : () => {}
    try {
      fn(a.dir, a.backend)
    } finally {
      restore()
      a.cleanup()
    }
  }

  describe(`append-only log sequence (${name})`, () => {
    it('numbers rows from 1 and reads only the rows after a sequence', () => {
      withAdapter((dir) => {
        const log = createAppendOnlyLog<{ n: number }>(join(dir, 's.jsonl'))
        assert.deepEqual(log.readAfter(0), [])
        log.append({ n: 10 })
        log.append({ n: 20 })
        log.append({ n: 30 })
        assert.deepEqual(log.readAfter(0).map((r) => r.seq), [1, 2, 3])
        assert.deepEqual(log.readAfter(2).map((r) => JSON.parse(r.line)), [{ n: 30 }])
        assert.deepEqual(log.readAfter(3), [])
        assert.deepEqual(log.readLines().length, 3)
      })
    })
  })

  describe(`jsonl log (${name})`, () => {
    it('reads nothing before the first append', () => {
      withAdapter((dir) => {
        assert.deepEqual(createJsonlLog(join(dir, 'a.jsonl')).readAll(), [])
      })
    })

    it('appends rows in order, creating parent directories', () => {
      withAdapter((dir) => {
        const log = createJsonlLog<{ n: number }>(join(dir, 'x', 'a.jsonl'))
        log.append({ n: 1 })
        log.append({ n: 2 })
        assert.deepEqual(log.readAll(), [{ n: 1 }, { n: 2 }])
      })
    })

    it('skips a corrupt line and keeps the rows around it', () => {
      withAdapter((dir) => {
        const path = join(dir, 'a.jsonl')
        const log = createJsonlLog<{ n: number }>(path)
        log.append({ n: 1 })
        createJsonlLog<string>(path).appendRaw('{broken\n\n')
        log.append({ n: 2 })
        assert.deepEqual(log.readAll(), [{ n: 1 }, { n: 2 }])
      })
    })

    it('rewrite replaces all rows atomically and an empty rewrite empties the log', () => {
      withAdapter((dir) => {
        const path = join(dir, 'a.jsonl')
        const log = createJsonlLog<{ n: number }>(path)
        log.append({ n: 1 })
        log.rewrite([{ n: 5 }, { n: 6 }])
        assert.deepEqual(log.readAll(), [{ n: 5 }, { n: 6 }])
        log.rewrite([])
        assert.deepEqual(log.readAll(), [])
        log.append({ n: 7 })
        assert.deepEqual(log.readAll(), [{ n: 7 }])
      })
    })

    it('resolves a path function on each call', () => {
      withAdapter((dir) => {
        let current = join(dir, 'one.jsonl')
        const log = createJsonlLog<{ n: number }>(() => current)
        log.append({ n: 1 })
        current = join(dir, 'two.jsonl')
        assert.deepEqual(log.readAll(), [])
      })
    })
  })

  describe(`collection (${name})`, () => {
    type Rec = { id: string; n: number }
    it('puts, gets, replaces, removes and counts single records', () => {
      withAdapter((dir) => {
        const c = createCollection<Rec>(join(dir, 'c', 'recs'))
        assert.equal(c.get('a'), undefined)
        assert.deepEqual(c.list(), [])
        c.put('a', { id: 'a', n: 1 })
        c.put('b', { id: 'b', n: 2 })
        c.put('a', { id: 'a', n: 9 })
        assert.deepEqual(c.get('a'), { id: 'a', n: 9 })
        assert.equal(c.count(), 2)
        assert.equal(c.remove('b'), true)
        assert.equal(c.remove('b'), false)
        assert.deepEqual(c.list(), [{ id: 'a', n: 9 }])
      })
    })

    it('lists in first-insert order, keeping a replaced record in place, and treats numeric-looking ids as plain ids', () => {
      withAdapter((dir) => {
        const c = createCollection<Rec>(join(dir, 'recs'))
        c.put('20', { id: '20', n: 1 })
        c.put('3', { id: '3', n: 2 })
        c.put('20', { id: '20', n: 3 })
        assert.deepEqual(c.list().map((r) => r.id), ['20', '3'])
      })
    })

    it('is a separate namespace from documents and logs, and clear empties only the collection', () => {
      withAdapter((dir) => {
        const doc = createDocumentStore<{ n: number }>({ path: join(dir, 'x.json'), initial: () => ({ n: 0 }) })
        doc.transaction((d) => void (d.n = 5))
        const c = createCollection<Rec>(join(dir, 'recs'))
        c.put('a', { id: 'a', n: 1 })
        c.clear()
        assert.equal(c.count(), 0)
        assert.deepEqual(doc.read(), { n: 5 })
      })
    })

    it('returns copies so callers cannot mutate stored records', () => {
      withAdapter((dir) => {
        const c = createCollection<{ id: string; tags: string[] }>(join(dir, 'recs'))
        c.put('a', { id: 'a', tags: ['x'] })
        c.get('a')!.tags.push('y')
        assert.deepEqual(c.get('a')!.tags, ['x'])
      })
    })
  })

  describe(`document store (${name})`, () => {
    type Doc = { n: number; legacy?: boolean }
    const open = (dir: string, extra: Partial<Parameters<typeof createDocumentStore<Doc>>[0]> = {}) =>
      createDocumentStore<Doc>({ path: join(dir, 'd', 'doc.json'), initial: () => ({ n: 0 }), ...extra })

    it('reads the initial document without writing', () => {
      withAdapter((dir) => {
        const store = open(dir)
        assert.deepEqual(store.read(), { n: 0 })
        store.read()
        if (name === 'file') assert.throws(() => readdirSync(join(dir, 'd')))
      })
    })

    it('a transaction reads, modifies, persists and returns the callback result', () => {
      withAdapter((dir) => {
        const store = open(dir)
        const result = store.transaction((doc) => ++doc.n)
        assert.equal(result, 1)
        assert.deepEqual(open(dir).read(), { n: 1 })
        if (name === 'file') assert.deepEqual(readdirSync(join(dir, 'd')), ['doc.json'])
      })
    })

    it('a throwing transaction persists nothing', () => {
      withAdapter((dir) => {
        const store = open(dir)
        store.transaction((doc) => void (doc.n = 1))
        assert.throws(() => store.transaction((doc) => { doc.n = 99; throw new Error('boom') }), /boom/)
        assert.deepEqual(store.read(), { n: 1 })
      })
    })

    it('surfaces a corrupt document instead of replacing it, unless told to fall back', () => {
      withAdapter((dir) => {
        const path = join(dir, 'd', 'doc.json')
        const broken = createDocumentStore<Doc>({ path, initial: () => ({ n: 0 }) })
        broken.transaction((doc) => void (doc.n = 1))
        writeText(path, '{broken')
        assert.throws(() => broken.read(), SyntaxError)
        assert.throws(() => broken.transaction(() => 1), SyntaxError)
        const lenient = createDocumentStore<Doc>({ path, initial: () => ({ n: 0 }), onCorrupt: 'initial' })
        assert.deepEqual(lenient.read(), { n: 0 })
      })
    })

    it('a lenient store also falls back when the document fails validation, and write replaces the document', () => {
      withAdapter((dir) => {
        const path = join(dir, 'd', 'doc.json')
        const lenient = createDocumentStore<Doc>({
          path,
          initial: () => ({ n: 0 }),
          validate: (doc) => { if (doc.n > 5) throw new Error('too big') },
          onCorrupt: 'initial',
        })
        writeText(path, JSON.stringify({ n: 9 }))
        assert.deepEqual(lenient.read(), { n: 0 })
        lenient.write({ n: 2 })
        assert.deepEqual(lenient.read(), { n: 2 })
      })
    })

    it('a durable store writes the same document and leaves no staging file', () => {
      withAdapter((dir) => {
        const store = open(dir, { durable: true, space: 0 })
        store.transaction((doc) => void (doc.n = 4))
        assert.deepEqual(open(dir).read(), { n: 4 })
        if (name === 'file') assert.deepEqual(readdirSync(join(dir, 'd')), ['doc.json'])
      })
    })

    it('validate rejects an invalid document', () => {
      withAdapter((dir) => {
        open(dir).transaction((doc) => void (doc.n = 3))
        const strict = open(dir, { validate: () => { throw new Error('Invalid store schema') } })
        assert.throws(() => strict.read(), /Invalid store schema/)
      })
    })

    it('migration is applied in memory on reads and persisted only by explicit migrate()', () => {
      withAdapter((dir) => {
        const seeded = open(dir)
        seeded.transaction((doc) => void ((doc as Doc).legacy = true))
        const store = open(dir, { migrate: (doc) => { delete doc.legacy } })
        assert.deepEqual(store.read(), { n: 0 })
        assert.equal(open(dir).read().legacy, true)
        assert.equal(store.migrate(), true)
        assert.equal(open(dir).read().legacy, undefined)
        assert.equal(store.migrate(), false)
      })
    })

    it('migrate() on a missing document writes nothing', () => {
      withAdapter((dir) => {
        const store = open(dir, { migrate: () => {} })
        assert.equal(store.migrate(), false)
        if (name === 'file') assert.throws(() => readdirSync(join(dir, 'd')))
      })
    })
  })
}

describe('disk document (state that lives beside the files it describes)', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'mice-disk-doc-'))

  it('round-trips, reports missing and corrupt files as absent, and creates parent directories', () => {
    const dir = tmp()
    try {
      const doc = createDiskDocument<{ a: number }>(join(dir, 'deep', 'state.json'))
      assert.equal(doc.read(), undefined)
      doc.write({ a: 1 })
      assert.deepEqual(doc.read(), { a: 1 })
      writeFileSync(join(dir, 'deep', 'state.json'), '{broken')
      assert.equal(doc.read(), undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates what it reads and leaves no temp file behind', () => {
    const dir = tmp()
    try {
      const doc = createDiskDocument<{ a: number }>(join(dir, 's.json'), (v) => { if (typeof (v as { a?: unknown }).a !== 'number') throw new Error('bad') })
      writeFileSync(join(dir, 's.json'), '{"a":"x"}')
      assert.equal(doc.read(), undefined)
      doc.write({ a: 2 })
      assert.deepEqual(readdirSync(dir), ['s.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
