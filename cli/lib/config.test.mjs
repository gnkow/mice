import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const configDir = mkdtempSync(join(tmpdir(), 'boxen-cli-config-'))
process.env.BOXEN_CONFIG_DIR = configDir
delete process.env.BOXEN_REMOTE
delete process.env.BOXEN_PAT

const {
  authHostFromRemote,
  clearLoginState,
  loadConfig,
  loadCredentials,
  resolveRemote,
  resolveToken,
  saveConfig,
  saveCredentials,
} = await import('./config.mjs')

describe('boxen CLI config', () => {
  before(() => {
    clearLoginState()
    delete process.env.BOXEN_REMOTE
    delete process.env.BOXEN_PAT
  })

  after(() => {
    delete process.env.BOXEN_CONFIG_DIR
    delete process.env.BOXEN_REMOTE
    delete process.env.BOXEN_PAT
    try {
      rmSync(configDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('defaults remote to localhost:8080', () => {
    clearLoginState()
    assert.equal(resolveRemote(), 'http://localhost:8080')
  })

  it('prefers BOXEN_REMOTE over saved config', () => {
    saveConfig({ remote: 'http://saved.example:8080' })
    process.env.BOXEN_REMOTE = 'http://env.example:9090/'
    assert.equal(resolveRemote(), 'http://env.example:9090')
    delete process.env.BOXEN_REMOTE
    assert.equal(resolveRemote(), 'http://saved.example:8080')
  })

  it('authHostFromRemote extracts host:port', () => {
    assert.equal(authHostFromRemote('http://localhost:8080'), 'localhost:8080')
    assert.equal(
      authHostFromRemote('https://boxen.example.com'),
      'boxen.example.com',
    )
  })

  it('resolveToken prefers BOXEN_PAT over credentials file', () => {
    saveCredentials({ token: 'boxen_pat_stored' })
    assert.equal(resolveToken(), 'boxen_pat_stored')
    process.env.BOXEN_PAT = 'boxen_pat_env'
    assert.equal(resolveToken(), 'boxen_pat_env')
    delete process.env.BOXEN_PAT
  })

  it('clearLoginState removes pat metadata and credentials', () => {
    saveConfig({
      remote: 'http://localhost:8080',
      authHost: 'localhost:8080',
      patId: 'abc',
      loggedInAt: new Date().toISOString(),
    })
    saveCredentials({ token: 'boxen_pat_x', patId: 'abc' })
    clearLoginState()
    const cfg = loadConfig()
    assert.equal(cfg.patId, undefined)
    assert.equal(cfg.loggedInAt, undefined)
    assert.equal(cfg.remote, 'http://localhost:8080')
    assert.deepEqual(loadCredentials(), {})
    assert.equal(resolveToken(), null)
  })
})
