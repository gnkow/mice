/**
 * CLI package integration for Ticket 35.
 * Login writes through credentialVault; a later resolveToken reads the same vault bytes.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const configDir = mkdtempSync(join(tmpdir(), 'mice-keychain-integ-'))
process.env.MICE_CONFIG_DIR = configDir
delete process.env.MICE_REMOTE
delete process.env.MICE_PAT

const { cmdLogin, cmdLogout } = await import('./login.mjs')
const { resolveToken, saveConfig } = await import('./config.mjs')
const { credentialVault, useKeychain, credentialFor } = await import('./keychain.mjs')

const REMOTE = 'http://bff.integ:8080'
const TOKEN = 'mice_cli_integ_access'
const REFRESH = 'mice_integ_refresh'

describe('Ticket 35 — CLI keychain package integ (login ↔ vault ↔ resolve)', () => {
  after(() => {
    useKeychain(null)
    delete process.env.MICE_CONFIG_DIR
    rmSync(configDir, { recursive: true, force: true })
  })

  it('login stores credential bytes in the vault and resolveToken reads them back', async () => {
    /** @type {string | null} */
    let secret = null
    let writes = 0
    const vault = credentialVault({
      read: () => secret,
      write: (next) => {
        writes += 1
        secret = next
      },
      clear: () => {
        secret = null
      },
    })
    useKeychain(vault)

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
              user_code: 'INTE-G001',
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
            user: { sub: 'integ', iss: 'http://idp', email: 'integ@mice.com', name: 'Integ' },
          },
        }
      },
    })

    assert.ok(writes >= 1, 'login must write through the vault backend')
    assert.ok(secret, 'vault secret bytes must be present after login')
    const parsed = JSON.parse(secret)
    assert.equal(parsed[0].token, TOKEN)
    assert.equal(parsed[0].refreshToken, REFRESH)
    assert.equal(parsed[0].principal, 'http://idp|integ')

    saveConfig({ remote: REMOTE })
    assert.equal(resolveToken(), TOKEN)
    assert.equal(credentialFor({ remote: REMOTE }).token, TOKEN)

    const credentialsJson = readFileSync(join(configDir, 'credentials.json'), 'utf8')
    assert.equal(credentialsJson.includes(TOKEN), false)
    assert.equal(credentialsJson.includes(REFRESH), false)

    await cmdLogout({
      remote: REMOTE,
      fetch: async () => ({ res: { ok: true, status: 200 }, json: {} }),
    })
    assert.equal(secret, null)
    assert.equal(resolveToken(), null)
  })
})
