import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatScope, type CliInfo } from './tokens.ts'

describe('CLI info and scope labels', () => {
  it('CliInfo documents mice-first examples', () => {
    const info: CliInfo = {
      remote: 'http://localhost:8080',
      authHost: 'localhost:8080',
      loginExample: 'mice login',
      cloneExample: 'mice clone http://localhost:8080/ns/repo',
      configExample: 'oxen config --auth localhost:8080',
      oxenCloneExample: 'oxen clone http://localhost:8080/ns/repo',
    }
    assert.match(info.loginExample ?? '', /mice login/)
    assert.match(info.cloneExample, /mice clone/)
    assert.match(info.configExample, /oxen config --auth/)
  })

  it('formats a namespace role and a repo role', () => {
    assert.equal(formatScope({ namespace: 'lab', maxRole: 'read' }), 'lab: read')
    assert.equal(formatScope({ namespace: 'lab', repo: 'study', maxRole: 'write' }), 'lab/study: write')
  })
})
