import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { createDiskDocument, diskReadiness } from './diskStore.js'

// Test artifacts stay in the project, never in a system temporary directory.
const tmp = () => {
  const root = resolve('.disk-test')
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, 'd-'))
}

describe('disk document (state that lives beside the files it describes)', () => {
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
      rmSync(resolve('.disk-test'), { recursive: true, force: true })
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
      rmSync(resolve('.disk-test'), { recursive: true, force: true })
    }
  })
})

describe('disk readiness', () => {
  it('is green for a writable data directory without leaving a probe file, red for one that cannot be written', () => {
    const dir = tmp()
    const previous = process.env.AUTH_DATA_DIR
    try {
      process.env.AUTH_DATA_DIR = dir
      assert.deepEqual(diskReadiness(), { ok: true })
      assert.deepEqual(readdirSync(dir), [])
      process.env.AUTH_DATA_DIR = '/dev/null/data'
      const red = diskReadiness()
      assert.equal(red.ok, false)
      assert.ok(red.detail)
    } finally {
      if (previous === undefined) delete process.env.AUTH_DATA_DIR
      else process.env.AUTH_DATA_DIR = previous
      rmSync(resolve('.disk-test'), { recursive: true, force: true })
    }
  })
})
