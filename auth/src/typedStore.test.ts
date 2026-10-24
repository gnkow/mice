import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { defineStore } from './typedStore.js'

type Doc = { version: 1; items: string[] }
const dir = mkdtempSync(join(tmpdir(), 'mice-store-'))
const make = (name: string) =>
  defineStore<Doc>({
    file: () => join(dir, name),
    empty: () => ({ version: 1, items: [] }),
    valid: (raw) => (raw as Doc | null)?.version === 1 && Array.isArray((raw as Doc).items),
  })

describe('typed store', () => {
  it('returns a fresh default for missing, corrupt and wrong-version files', () => {
    assert.deepEqual(make('missing.json').read(), { version: 1, items: [] })
    writeFileSync(join(dir, 'corrupt.json'), '{nope')
    assert.deepEqual(make('corrupt.json').read(), { version: 1, items: [] })
    writeFileSync(join(dir, 'v2.json'), JSON.stringify({ version: 2, items: ['x'] }))
    assert.deepEqual(make('v2.json').read(), { version: 1, items: [] })
  })

  it('persists read-modify-write and returns the updater result', () => {
    const store = make('rmw.json')
    const n = store.update((d) => d.items.push('a'))
    assert.equal(n, 1)
    store.update((d) => d.items.push('b'))
    assert.deepEqual(store.read().items, ['a', 'b'])
  })

  it('write replaces the document', () => {
    const store = make('w.json')
    store.write({ version: 1, items: ['z'] })
    assert.deepEqual(make('w.json').read().items, ['z'])
  })
})
