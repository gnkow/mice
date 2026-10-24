import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend, type JsonBackend } from './jsonStore.js'
import { createDocumentStore, createJsonlLog } from './stores.js'

const adapters: Record<string, () => { dir: string; backend?: JsonBackend; cleanup(): void }> = {
  file: () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-stores-'))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
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
        createJsonlLog<string>(path).appendRaw('{broken')
        assert.throws(() => broken.read(), SyntaxError)
        assert.throws(() => broken.transaction(() => 1), SyntaxError)
        const lenient = createDocumentStore<Doc>({ path, initial: () => ({ n: 0 }), onCorrupt: 'initial' })
        assert.deepEqual(lenient.read(), { n: 0 })
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
