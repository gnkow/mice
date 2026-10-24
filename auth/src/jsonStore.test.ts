import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  createMemoryJsonBackend,
  readJsonFile,
  useJsonBackend,
  writeJsonFile,
} from './jsonStore.js'

describe('json store backends', () => {
  it('file backend round-trips and leaves no temp files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-json-'))
    try {
      const path = join(dir, 'a', 'x.json')
      assert.deepEqual(readJsonFile(path, { n: 0 }), { n: 0 })
      writeJsonFile(path, { n: 1 })
      assert.deepEqual(readJsonFile(path, { n: 0 }), { n: 1 })
      assert.deepEqual(readdirSync(join(dir, 'a')), ['x.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('memory backend round-trips without touching disk and restores the previous backend', () => {
    const path = join(tmpdir(), 'mice-json-never-written', 'y.json')
    const restore = useJsonBackend(createMemoryJsonBackend())
    try {
      assert.deepEqual(readJsonFile(path, []), [])
      writeJsonFile(path, ['a'])
      assert.deepEqual(readJsonFile(path, []), ['a'])
      assert.equal(existsSync(path), false)
    } finally {
      restore()
    }
    assert.deepEqual(readJsonFile(path, 'fallback'), 'fallback')
  })

  it('memory backend returns copies so callers cannot mutate stored state', () => {
    const restore = useJsonBackend(createMemoryJsonBackend())
    try {
      writeJsonFile('/m/z.json', { list: [1] })
      const a = readJsonFile<{ list: number[] }>('/m/z.json', { list: [] })
      a.list.push(2)
      assert.deepEqual(readJsonFile('/m/z.json', null), { list: [1] })
    } finally {
      restore()
    }
  })
})
