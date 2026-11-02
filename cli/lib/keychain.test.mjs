import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const configDir = mkdtempSync(join(tmpdir(), 'mice-keychain-'))
process.env.MICE_CONFIG_DIR = configDir
delete process.env.MICE_REMOTE
delete process.env.MICE_PAT

const { cmdLogin, cmdLogout } = await import('./login.mjs')
const { loadCredentials, resolveToken, saveConfig, saveCredentials } = await import('./config.mjs')
const { memoryKeychain, useKeychain, credentialFor, actingAsMessage } = await import('./keychain.mjs')

const REMOTE = 'http://bff.example:8080'
const TOKEN = 'mice_cli_access'
const REFRESH = 'mice_refresh_secret'

describe('CLI keychain', () => {
  after(() => {
    useKeychain(null)
    delete process.env.MICE_CONFIG_DIR
    rmSync(configDir, { recursive: true, force: true })
  })

  it('mice login stores the device credential for that Principal and remote', async () => {
    const keychain = memoryKeychain()
    useKeychain(keychain)
    await cmdLogin({
      remote: REMOTE,
      open: false,
      findOxen: () => true,
      configureOxen: () => {},
      sleep: async () => {},
      fetch: async (_remote, path) => {
        if (path === '/auth/cli/device/start') {
          return {
            res: { ok: true },
            json: {
              device_code: 'device',
              user_code: 'ABCD-EFGH',
              verification_uri_complete: 'http://verify',
              interval: 0,
              expires_in: 60,
            },
          }
        }
        return {
          res: { ok: true },
          json: {
            status: 'approved',
            access_token: TOKEN,
            refresh_token: REFRESH,
            user: { sub: 'ada', iss: 'http://idp', email: 'ada@mice.com', name: 'Ada' },
          },
        }
      },
    })

    const stored = await credentialFor({ remote: REMOTE })
    assert.equal(stored.token, TOKEN)
    assert.equal(stored.refreshToken, REFRESH)
    assert.equal(stored.principal, 'http://idp|ada')
    assert.equal(readFileSync(join(configDir, 'credentials.json'), 'utf8').includes(TOKEN), false)
    assert.equal(readFileSync(join(configDir, 'credentials.json'), 'utf8').includes(REFRESH), false)
  })

  it('a later command reads that keychain entry', () => {
    const store = memoryKeychain()
    useKeychain(store)
    store.put({
      principal: 'http://idp|ada',
      remote: REMOTE,
      token: TOKEN,
      refreshToken: REFRESH,
    })
    saveConfig({ remote: REMOTE })
    saveCredentials({ remote: REMOTE })
    assert.equal(resolveToken(), TOKEN)
  })

  it('refuses login of a second Principal on the same OS user', async () => {
    const store = memoryKeychain()
    useKeychain(store)
    store.put({
      principal: 'http://idp|ada',
      remote: REMOTE,
      token: 'mice_cli_ada',
      refreshToken: 'mice_refresh_ada',
    })
    process.exitCode = 0
    await cmdLogin({
      remote: 'http://other.example:8080',
      open: false,
      findOxen: () => true,
      configureOxen: () => {},
      sleep: async () => {},
      fetch: async (_remote, path) => {
        if (path === '/auth/cli/device/start') {
          return {
            res: { ok: true },
            json: {
              device_code: 'device',
              user_code: 'WXYZ-1234',
              verification_uri_complete: 'http://verify',
              interval: 0,
              expires_in: 60,
            },
          }
        }
        return {
          res: { ok: true },
          json: {
            status: 'approved',
            access_token: 'mice_cli_grace',
            refresh_token: 'mice_refresh_grace',
            user: { sub: 'grace', iss: 'http://idp', email: 'grace@mice.com', name: 'Grace' },
          },
        }
      },
    })
    assert.equal(process.exitCode, 1)
    process.exitCode = 0
    assert.equal(credentialFor({ remote: 'http://other.example:8080' }), null)
    assert.equal(credentialFor({ remote: REMOTE }).token, 'mice_cli_ada')
  })

  it('asks who it is acting as before a write when several remotes are stored', () => {
    const store = memoryKeychain()
    useKeychain(store)
    store.put({
      principal: 'http://idp|ada',
      remote: REMOTE,
      token: TOKEN,
      email: 'ada@mice.com',
      name: 'Ada',
    })
    store.put({
      principal: 'http://idp|ada',
      remote: 'http://other.example:8080',
      token: 'mice_cli_other',
      email: 'ada@mice.com',
      name: 'Ada',
    })
    assert.equal(actingAsMessage({ remote: REMOTE, write: false }), null)
    assert.equal(
      actingAsMessage({ remote: REMOTE, write: true }),
      'Acting as Ada <ada@mice.com> at http://bff.example:8080',
    )

    const one = memoryKeychain()
    useKeychain(one)
    one.put({
      principal: 'http://idp|ada',
      remote: REMOTE,
      token: TOKEN,
      email: 'ada@mice.com',
      name: 'Ada',
    })
    assert.equal(actingAsMessage({ remote: REMOTE, write: true }), null)
  })

  it('logout removes the keychain credential for that remote', async () => {
    const store = memoryKeychain()
    useKeychain(store)
    store.put({
      principal: 'http://idp|ada',
      remote: REMOTE,
      token: TOKEN,
      refreshToken: REFRESH,
    })
    store.put({
      principal: 'http://idp|ada',
      remote: 'http://other.example:8080',
      token: 'mice_cli_other',
      refreshToken: 'mice_refresh_other',
    })
    saveConfig({ remote: REMOTE })
    await cmdLogout({
      remote: REMOTE,
      fetch: async () => ({ res: { ok: true, status: 200 }, json: {} }),
    })
    assert.equal(credentialFor({ remote: REMOTE }), null)
    assert.equal(credentialFor({ remote: 'http://other.example:8080' }).token, 'mice_cli_other')
    assert.equal(resolveToken(), null)
  })
})
