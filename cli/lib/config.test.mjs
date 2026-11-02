import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const configDir = mkdtempSync(join(tmpdir(), 'mice-cli-config-'))
process.env.MICE_CONFIG_DIR = configDir
delete process.env.MICE_REMOTE
delete process.env.MICE_PAT

const { memoryKeychain, useKeychain } = await import('./keychain.mjs')
const keychain = memoryKeychain()
useKeychain(keychain)

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

describe('mice CLI config', () => {
  before(() => {
    clearLoginState()
    delete process.env.MICE_REMOTE
    delete process.env.MICE_PAT
  })

  after(() => {
    delete process.env.MICE_CONFIG_DIR
    delete process.env.MICE_REMOTE
    delete process.env.MICE_PAT
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

  it('prefers MICE_REMOTE over saved config', () => {
    saveConfig({ remote: 'http://saved.example:8080' })
    process.env.MICE_REMOTE = 'http://env.example:9090/'
    assert.equal(resolveRemote(), 'http://env.example:9090')
    delete process.env.MICE_REMOTE
    assert.equal(resolveRemote(), 'http://saved.example:8080')
  })

  it('authHostFromRemote extracts host:port', () => {
    assert.equal(authHostFromRemote('http://localhost:8080'), 'localhost:8080')
    assert.equal(
      authHostFromRemote('https://mice.example.com'),
      'mice.example.com',
    )
  })

  it('resolveToken reads the keychain entry for the remote', () => {
    saveConfig({ remote: 'http://localhost:8080' })
    keychain.put({
      principal: 'http://idp|ada',
      remote: 'http://localhost:8080',
      token: 'mice_cli_stored',
    })
    assert.equal(resolveToken(), 'mice_cli_stored')
    process.env.MICE_PAT = 'mice_pat_env'
    assert.equal(resolveToken(), 'mice_cli_stored')
    delete process.env.MICE_PAT
    keychain.remove({ remote: 'http://localhost:8080' })
  })

  it('clearLoginState removes login metadata and credentials', () => {
    saveConfig({
      remote: 'http://localhost:8080',
      authHost: 'localhost:8080',
      loggedInAt: new Date().toISOString(),
    })
    saveCredentials({ token: 'mice_cli_x' })
    clearLoginState()
    const cfg = loadConfig()
    assert.equal(cfg.loggedInAt, undefined)
    assert.equal(cfg.remote, 'http://localhost:8080')
    assert.deepEqual(loadCredentials(), {})
    assert.equal(resolveToken(), null)
  })
})
