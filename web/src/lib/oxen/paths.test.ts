import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  baseName,
  isRenamePathChange,
  joinPath,
  looksLikeCommitId,
  parentPath,
  resourcePath,
} from './paths.ts'

describe('oxen paths helpers', () => {
  it('resourcePath encodes branch and segments', () => {
    assert.equal(resourcePath('main', 'a/b.txt'), 'main/a/b.txt')
    assert.equal(resourcePath('feat/x', 'docs/a b.txt'), 'feat%2Fx/docs/a%20b.txt')
  })

  it('joinPath / parentPath / baseName', () => {
    assert.equal(joinPath('a', '/b/', 'c.txt'), 'a/b/c.txt')
    assert.equal(parentPath('a/b/c.txt'), 'a/b')
    assert.equal(parentPath('alone.txt'), '')
    assert.equal(baseName('a/b/c.txt'), 'c.txt')
  })

  it('looksLikeCommitId matches oxen hex ids', () => {
    assert.equal(looksLikeCommitId('main'), false)
    assert.equal(looksLikeCommitId('feature/x'), false)
    assert.equal(
      looksLikeCommitId('0123456789abcdef0123456789abcdef'),
      true,
    )
    assert.equal(looksLikeCommitId('abc'), false)
  })

  it('isRenamePathChange: same folder + different name', () => {
    assert.equal(isRenamePathChange('docs/a.txt', 'docs/b.txt'), true)
    assert.equal(isRenamePathChange('a.txt', 'b.txt'), true)
    assert.equal(isRenamePathChange('a.txt', 'dir/a.txt'), false)
    assert.equal(isRenamePathChange('docs/a.txt', 'docs/a.txt'), false)
    assert.equal(isRenamePathChange('', 'b.txt'), false)
  })
})
