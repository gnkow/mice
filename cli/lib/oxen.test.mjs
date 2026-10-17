import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  looksLikeDirectOxenServer,
  rewriteArgsForBff,
} from './oxen.mjs'

describe('looksLikeDirectOxenServer', () => {
  it('detects :3001 in URLs and hosts', () => {
    assert.equal(looksLikeDirectOxenServer('http://localhost:3001'), true)
    assert.equal(looksLikeDirectOxenServer('http://127.0.0.1:3001/ns/r'), true)
    assert.equal(looksLikeDirectOxenServer('localhost:3001'), true)
    assert.equal(looksLikeDirectOxenServer('http://localhost:8080'), false)
    assert.equal(looksLikeDirectOxenServer('http://localhost:8080/ns/r'), false)
    assert.equal(looksLikeDirectOxenServer('not a url'), false)
  })
})

describe('rewriteArgsForBff', () => {
  it('rewrites :3001 clone URLs to BFF and preserves path', () => {
    const { args, rewritten } = rewriteArgsForBff(
      ['clone', 'http://localhost:3001/acme/data'],
      'http://localhost:8080',
    )
    assert.equal(rewritten, true)
    assert.deepEqual(args, ['clone', 'http://localhost:8080/acme/data'])
  })

  it('leaves BFF URLs and non-URL args alone', () => {
    const { args, rewritten } = rewriteArgsForBff(
      ['clone', 'http://localhost:8080/acme/data', '--shallow'],
      'http://localhost:8080',
    )
    assert.equal(rewritten, false)
    assert.deepEqual(args, [
      'clone',
      'http://localhost:8080/acme/data',
      '--shallow',
    ])
  })

  it('rewrites multiple URL args', () => {
    const { args, rewritten } = rewriteArgsForBff(
      [
        'remote',
        'add',
        'origin',
        'http://127.0.0.1:3001/ns/repo',
      ],
      'https://boxen.example.com',
    )
    assert.equal(rewritten, true)
    assert.equal(args[3], 'https://boxen.example.com/ns/repo')
  })
})
