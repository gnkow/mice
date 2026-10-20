import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { DesktopSession } from './sessionsTypes.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-sess-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.SESSIONS_DATA_DIR = join(dataDir, 'sessions')
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.SESSIONS_CONNECT_BACKEND = 'guacamole_lite'
process.env.SESSIONS_ENABLED = 'true'
process.env.SESSIONS_MAX_MOUNTS = '8'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'

const {
  authorizeSessionAccess,
  authorizeSessionCreate,
  guestUserFromOwner,
  parseCreateBody,
  publicSession,
  sessionsAuditRetentionPolicy,
} = await import('./sessions.js')
const {
  setAuthzEnforce,
  writeInstancePermissions,
} = await import('./authzStore.js')
const { encryptGuacamoleLiteToken, mintConnectPayload } = await import(
  './sessionsConnect.js'
)
const {
  assignMountPaths,
  mountWorkKey,
  normalizeDesktopSession,
  normalizeSessionMounts,
} = await import('./sessionsMounts.js')
const { listSessionTemplates } = await import('./sessionsTemplates.js')

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function baseSession(
  patch: Partial<DesktopSession> = {},
): DesktopSession {
  return {
    id: 'a'.repeat(16),
    status: 'ready',
    owner: { sub: 's', iss: 'i', email: 'e', name: 'n' },
    via: 'session',
    template_id: null,
    image: 'img',
    image_digest: null,
    provisioner: 'docker',
    endpoints: null,
    guest_user: 'u',
    guest_password: 'secret',
    mounts: [],
    workspace_ref: null,
    pin_commit: null,
    mount_path: null,
    mount_mode: null,
    resources: { cpu: '1', memory: '1g', disk: '10g' },
    recording: false,
    last_activity_at: null,
    connected_at: null,
    rustguac_session_id: null,
    created_at: new Date().toISOString(),
    ready_at: null,
    stopped_at: null,
    destroyed_at: null,
    error: null,
    runtime_id: null,
    ...patch,
  }
}

describe('sessions', () => {
  it('guestUserFromOwner derives per-user linux name from email', () => {
    assert.equal(
      guestUserFromOwner({
        sub: 'abc',
        iss: 'http://idp',
        email: 'Jane.Doe@example.com',
        name: 'Jane',
        groups: [],
      } as never),
      'janedoe',
    )
  })

  it('parseCreateBody accepts legacy workspace_ref', () => {
    const parsed = parseCreateBody({
      template_id: 'linux-xfce',
      workspace_ref: { namespace: 'ns', repo: 'r', workspace_id: null },
      pin_commit: 'abc123',
      mount_mode: 'ro',
    })
    assert.ok(!('error' in parsed))
    assert.equal(parsed.template_id, 'linux-xfce')
    assert.equal(parsed.workspace_ref?.namespace, 'ns')
    assert.equal(parsed.mount_mode, 'ro')
  })

  it('parseCreateBody accepts mounts[]', () => {
    const parsed = parseCreateBody({
      template_id: 'linux-xfce',
      mounts: [
        {
          namespace: 'ns',
          repo: 'a',
          workspace_id: 'ws1',
          mount_mode: 'rw',
        },
        {
          namespace: 'ns',
          repo: 'b',
          pin_commit: 'deadbeef',
          mount_mode: 'ro',
        },
      ],
    })
    assert.ok(!('error' in parsed))
    assert.equal(parsed.mounts?.length, 2)
    assert.equal(parsed.mounts?.[0]?.workspace_id, 'ws1')
    assert.equal(parsed.mounts?.[1]?.pin_commit, 'deadbeef')
  })

  it('parseCreateBody rejects mount without source', () => {
    const parsed = parseCreateBody({
      mounts: [{ namespace: 'ns', repo: 'r' }],
    })
    assert.ok('error' in parsed)
  })

  it('assignMountPaths is deterministic and suffixes collisions', () => {
    const mounts = assignMountPaths([
      { namespace: 'Ns', repo: 'Repo', pin_commit: 'aaa', mount_mode: 'ro' },
      { namespace: 'ns', repo: 'repo', pin_commit: 'bbb', mount_mode: 'rw' },
    ])
    assert.equal(mounts.length, 2)
    assert.equal(mounts[0]!.mount_path, '/data/ns/repo')
    assert.ok(mounts[1]!.mount_path.startsWith('/data/ns/repo__'))
    assert.notEqual(mounts[0]!.mount_path, mounts[1]!.mount_path)
  })

  it('normalizeSessionMounts lifts legacy singular fields', () => {
    const s = baseSession({
      mounts: [],
      workspace_ref: { namespace: 'n', repo: 'r', workspace_id: 'w1' },
      pin_commit: null,
      mount_path: '/data',
      mount_mode: 'ro',
    })
    const mounts = normalizeSessionMounts(s)
    assert.equal(mounts.length, 1)
    assert.equal(mounts[0]!.workspace_id, 'w1')
    assert.equal(mounts[0]!.mount_mode, 'ro')
  })

  it('mountWorkKey is stable and safe', () => {
    const key = mountWorkKey(
      {
        namespace: 'n',
        repo: 'r',
        workspace_id: null,
        pin_commit: 'abc',
        mount_mode: 'rw',
        mount_path: '/data/foo/bar',
      },
      0,
    )
    assert.ok(key.length > 0)
    assert.equal(key.includes('/'), false)
  })

  it('publicSession redacts guest_password and exposes mounts', () => {
    const pub = publicSession(
      normalizeDesktopSession(
        baseSession({
          mounts: [
            {
              namespace: 'n',
              repo: 'r',
              workspace_id: null,
              pin_commit: 'c'.repeat(40),
              mount_mode: 'ro',
              mount_path: '/data/n/r',
            },
          ],
        }),
      ),
    )
    assert.equal('guest_password' in pub, false)
    assert.equal(pub.mounts.length, 1)
  })

  it('templates catalog is non-empty', () => {
    assert.ok(listSessionTemplates().length >= 1)
  })

  it('encryptGuacamoleLiteToken produces base64 token', () => {
    const key = 'MySuperSecretKeyForParamsToken12'
    const token = encryptGuacamoleLiteToken(
      { connection: { type: 'rdp', settings: { hostname: 'h' } } },
      key,
    )
    assert.ok(token.length > 16)
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as {
      iv: string
      value: string
    }
    assert.ok(parsed.iv && parsed.value)
  })

  it('mintConnectPayload guacamole_lite returns ticket + token', async () => {
    const session = baseSession({
      id: 'b'.repeat(16),
      template_id: 'linux-xfce',
      guest_user: 'miceuser',
      guest_password: 'pw',
      endpoints: {
        rdp_host: 'mice-sess-test',
        rdp_port: 3389,
        container_name: 'mice-sess-test',
      },
      ready_at: new Date().toISOString(),
    })
    const payload = await mintConnectPayload(session)
    assert.equal(payload.backend, 'guacamole_lite')
    assert.ok(payload.ticket.startsWith('wst_'))
    assert.ok(payload.token)
    assert.ok(payload.client_url.includes('/sessions/'))
  })

  it('sessionsAuditRetentionPolicy exposes Phase 3 retention', () => {
    const p = sessionsAuditRetentionPolicy()
    assert.equal(p.purge_enabled, false)
    assert.ok(p.actions.includes('session.connect'))
  })

  it('authorizeSessionCreate/connect deny without instance perms under enforce', () => {
    const user = {
      sub: 'sess-user',
      iss: 'test',
      email: 'sess@example.com',
      name: 'Sess',
    }
    setAuthzEnforce(true)
    writeInstancePermissions(user, [])
    assert.equal(authorizeSessionCreate(user).allow, false)

    writeInstancePermissions(user, ['session_create'])
    assert.equal(authorizeSessionCreate(user).allow, true)

    const owned = baseSession({
      owner: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
    })
    assert.equal(authorizeSessionAccess(user, owned, 'connect').allow, false)
    assert.equal(authorizeSessionAccess(user, owned, 'stop').allow, true)

    writeInstancePermissions(user, ['session_create', 'session_connect'])
    assert.equal(authorizeSessionAccess(user, owned, 'connect').allow, true)
    writeInstancePermissions(user, [])
  })
})
