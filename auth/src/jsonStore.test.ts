import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  createFileJsonBackend,
  createMemoryJsonBackend,
  readText,
  useJsonBackend,
  writeText,
} from './jsonStore.js'

describe('json store backends', () => {
  it('file backend round-trips and leaves no temp files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mice-json-'))
    const restore = useJsonBackend(createFileJsonBackend())
    try {
      const path = join(dir, 'a', 'x.json')
      assert.equal(readText(path), undefined)
      writeText(path, '{"n":1}')
      assert.equal(readText(path), '{"n":1}')
      assert.deepEqual(readdirSync(join(dir, 'a')), ['x.json'])
    } finally {
      restore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('memory backend round-trips without touching disk and restores the previous backend', () => {
    const path = join(tmpdir(), 'mice-json-never-written', 'y.json')
    const restore = useJsonBackend(createMemoryJsonBackend())
    try {
      assert.equal(readText(path), undefined)
      writeText(path, '["a"]')
      assert.equal(readText(path), '["a"]')
      assert.equal(existsSync(path), false)
    } finally {
      restore()
    }
    assert.equal(readText(path), undefined)
  })
})
