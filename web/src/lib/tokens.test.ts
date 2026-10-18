import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CliInfo, CreatePatResponse, PatPublic } from './tokens.ts'

describe('CLI / token client types', () => {
  it('CliInfo documents boxen-first examples', () => {
    const info: CliInfo = {
      remote: 'http://localhost:8080',
      authHost: 'localhost:8080',
      loginExample: 'boxen login',
      cloneExample: 'boxen clone http://localhost:8080/ns/repo',
      configExample: 'oxen config --auth localhost:8080 <PAT>',
      oxenCloneExample: 'oxen clone http://localhost:8080/ns/repo',
    }
    assert.match(info.loginExample ?? '', /boxen login/)
    assert.match(info.cloneExample, /boxen clone/)
    assert.match(info.configExample, /oxen config --auth/)
  })

  it('CreatePatResponse carries one-time token + cli hints', () => {
    const pat: PatPublic = {
      id: 'abc',
      label: 'CI',
      prefix: 'boxen_pat_xxxxxx',
      createdAt: new Date().toISOString(),
    }
    const created: CreatePatResponse = {
      token: 'boxen_pat_secret',
      pat,
      cli: {
        remote: 'http://localhost:8080',
        config: 'oxen config --auth localhost:8080 boxen_pat_secret',
      },
    }
    assert.match(created.token, /^boxen_pat_/)
    assert.ok(created.cli.config.includes(created.token))
  })
})
