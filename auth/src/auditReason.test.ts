import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { fakeClock, useClock } = await import('./clock.js')
const { overrideEnv } = await import('./env.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
let since = 0
const admin = iso.admin
await preparePrincipal(admin)
const writer = iso.person('reason-writer')
const manager = iso.person('reason-manager')
await createNamespaceAuthz(admin, 'rs', 'none', true)
await setRepoCollaborator('rs', 'r', writer, 'write')
await preparePrincipal(writer)
await iso.grantRole(writer, 'user')
await iso.grantRole(manager, 'manager')

type Row = {
  id: string
  action: string
  phase?: string
  status: number
  message?: string
  reason?: string
  reason_source?: string
  category?: string
}
const rows = async () =>
  (await ledger.readAll()).filter((r) => r.seq > since).map((r) => JSON.parse(r.value) as Row)
const outcomes = async () => (await rows()).filter((r) => r.phase === 'outcome')

let upstream: Array<{ url: string; headers: Headers }>
let restoreUpstream: () => void
const app = createApp()

beforeEach(async () => {
  since = (await ledger.readAll()).reduce((m, r) => Math.max(m, r.seq), 0)
  upstream = []
  restoreUpstream = setUpstreamFetch(async (url, init) => {
    upstream.push({ url: String(url), headers: new Headers(init?.headers) })
    return new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => restoreUpstream())

async function putJson(message: string | undefined, extra: Record<string, string> = {}, user = writer) {
  return app.request('/api/repos/rs/r/file/main/a.csv', {
    method: 'PUT',
    headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json', ...extra },
    body: JSON.stringify(message === undefined ? {} : { message }),
  })
}

await describe('mandatory reason on proxied dataset mutations', async () => {
  await it('allows a file write without a reason (new data is create-exempt)', async () => {
    const res = await putJson(undefined)
    assert.equal(res.status, 200)
    assert.ok(upstream.length >= 1)
    const o = (await outcomes()).find((r) => r.action === 'file.write')!
    assert.equal(o.reason, undefined)
  })

  await it('allows a branch create without a reason', async () => {
    const branch = await app.request('/api/repos/rs/r/branches', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'feature' }),
    })
    assert.equal(branch.status, 200)
    assert.ok(upstream.length >= 1)
    const o = (await outcomes()).find((r) => r.action === 'branch.create')
    assert.equal(o?.reason, undefined)
  })

  await it('rejects a branch delete without a reason before anything reaches oxen', async () => {
    const del = await app.request('/api/repos/rs/r/branches/old', {
      method: 'DELETE',
      headers: await iso.sessionHeaders(admin),
    })
    assert.equal(del.status, 400)
    assert.equal(((await del.json()) as { status_message: string }).status_message, 'reason_required')
    assert.equal(upstream.length, 0)
  })

  await it('rejects a branch delete with free text but no category', async () => {
    const del = await app.request('/api/repos/rs/r/branches/old', {
      method: 'DELETE',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        'x-mice-reason': 'Branch merged and obsolete',
      },
    })
    assert.equal(del.status, 400)
    assert.equal(((await del.json()) as { status_message: string }).status_message, 'reason_category_required')
    assert.equal(upstream.length, 0)
  })

  await it('accepts a branch delete with category and free text and records both', async () => {
    const path = '/api/repos/rs/r/branches/old'
    const signed = await regulatedMutationHeaders(admin, {
      method: 'DELETE',
      path,
      body: {},
      reason: 'Branch merged and obsolete',
      category: 'destructive',
    })
    const ok = await app.request(path, {
      method: 'DELETE',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        ...signed,
        'x-mice-change-control-id': 'CC-2026-114',
      },
    })
    assert.equal(ok.status, 200)
    const o = (await outcomes())[0]!
    assert.equal(o.reason, 'Branch merged and obsolete')
    assert.equal(o.reason_source, 'explicit')
    assert.equal(o.category, 'destructive')
    assert.equal(upstream[0]!.headers.get('x-mice-reason'), null)
    assert.equal(upstream[0]!.headers.get('x-mice-reason-category'), null)
  })

  await it('rejects a too-short reason on a delete even with a valid category', async () => {
    const del = await app.request('/api/repos/rs/r/branches/old', {
      method: 'DELETE',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        'x-mice-reason': 'short',
        'x-mice-reason-category': 'destructive', 'x-mice-change-control-id': 'CC-2026-114',
      },
    })
    assert.equal(del.status, 400)
    assert.equal(((await del.json()) as { status_message: string }).status_message, 'reason_too_short')
    assert.equal(upstream.length, 0)
  })

  await it('takes the minimum length from one setting on deletes', async () => {
    const restore = overrideEnv({ auditReasonMinLength: 30 })
    try {
      const short = await app.request('/api/repos/rs/r/branches/old', {
        method: 'DELETE',
        headers: {
          ...(await iso.sessionHeaders(admin)),
          'x-mice-reason': 'Branch merged and obsolete',
          'x-mice-reason-category': 'destructive', 'x-mice-change-control-id': 'CC-2026-114',
        },
      })
      assert.equal(short.status, 400)
    } finally {
      restore()
    }
    const path = '/api/repos/rs/r/branches/old'
    const signed = await regulatedMutationHeaders(admin, {
      method: 'DELETE',
      path,
      body: {},
      reason: 'Branch merged and obsolete',
      category: 'destructive',
    })
    const ok = await app.request(path, {
      method: 'DELETE',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        ...signed,
        'x-mice-change-control-id': 'CC-2026-114',
      },
    })
    assert.equal(ok.status, 200)
  })

  await it('does not ask for a reason on reads or on object uploads that change nothing visible', async () => {
    const get = await app.request('/api/repos/rs/r/branches', { headers: await iso.sessionHeaders(writer) })
    assert.equal(get.status, 200)
    const stage = await app.request('/api/repos/rs/r/workspaces/w1/files/a.csv', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(stage.status, 200)
  })
})

const adminHeaders = async (reason?: string) => ({
  ...(await iso.sessionHeaders(admin)),
  'content-type': 'application/json',
  ...(reason
    ? { 'x-mice-reason': reason, 'x-mice-reason-category': 'privileged_settings', 'x-mice-change-control-id': 'CC-2026-114' }
    : {}),
})

await describe('mandatory reason on admin and permission changes', async () => {
  await it('allows a namespace create without a reason (new resources are exempt)', async () => {
    // Manager (not Admin) creates namespaces — Admin has no data-plane create (S25).
    const managerHeaders = async () => ({
      ...(await iso.sessionHeaders(manager)),
      'content-type': 'application/json',
    })
    const res = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: await managerHeaders(),
      body: JSON.stringify({ name: 'newns', basePermission: 'none' }),
    })
    assert.equal(res.status, 200)
    const o = (await outcomes()).find((r) => r.action === 'namespace.create')!
    assert.equal(o.reason, undefined)
  })

  await it('requires category and free text on a namespace settings update', async () => {
    await createNamespaceAuthz(admin, 'upd', 'none', true)
    // Seed ownership so the manager can patch (createNamespaceAuthz with admin may need a manager-owned ns).
    const create = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(manager)), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'upd-mgr', basePermission: 'none' }),
    })
    assert.equal(create.status, 200)

    const noCat = await app.request('/auth/namespaces/upd-mgr', {
      method: 'PATCH',
      headers: {
        ...(await iso.sessionHeaders(manager)),
        'content-type': 'application/json',
        'x-mice-reason': 'Tighten default access after review',
      },
      body: JSON.stringify({ basePermission: 'read' }),
    })
    assert.equal(noCat.status, 400)
    assert.equal(((await noCat.json()) as { code: string }).code, 'reason_category_required')

    const path = '/auth/namespaces/upd-mgr'
    const body = { basePermission: 'read' }
    const signed = await regulatedMutationHeaders(manager, {
      method: 'PATCH',
      path,
      body,
      reason: 'Tighten default access after review',
      category: 'privileged_settings',
    })
    const ok = await app.request(path, {
      method: 'PATCH',
      headers: {
        ...(await iso.sessionHeaders(manager)),
        ...signed,
        'x-mice-change-control-id': 'CC-2026-114',
      },
      body: JSON.stringify(body),
    })
    assert.equal(ok.status, 200)
    const o = (await outcomes()).find((r) => r.action === 'namespace.settings.update')!
    assert.equal(o.reason, 'Tighten default access after review')
    assert.equal(o.category, 'privileged_settings')
  })

  await it('applies to instance permission changes and access-request decisions', async () => {
    const add = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: await adminHeaders(),
      body: JSON.stringify({ sub: 'x', iss: 'idp', permissions: [] }),
    })
    assert.equal(add.status, 400)
    const decide = await app.request('/auth/access-requests/nope', {
      method: 'POST',
      headers: await adminHeaders(),
      body: JSON.stringify({ action: 'deny' }),
    })
    assert.equal(decide.status, 400)
  })

  await it('does not ask for a reason on token management', async () => {
    const res = await app.request('/auth/me/tokens/missing', {
      method: 'DELETE',
      headers: await adminHeaders(),
    })
    assert.equal(res.status, 404)
  })
})

await describe('service principals', async () => {
  await it('has no route that creates one', async () => {
    const res = await app.request('/auth/instance/service-principals', {
      method: 'POST',
      headers: await adminHeaders('Register the nightly ingest job'),
      body: JSON.stringify({ name: 'ingest', owner: writer, reason: 'Nightly instrument ingest' }),
    })
    assert.equal(res.status, 404)
  })
})

await describe('declared reason for clients that cannot send a header', async () => {
  const declare = async (
    reason: string,
    ttlSec?: number,
    category = 'data_correction',
    changeControlId = 'CC-2026-114',
  ) =>
    app.request('/auth/reason', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json' },
      body: JSON.stringify({ reason, ttlSec, category, changeControlId }),
    })
  const pushLike = async (opts?: { reason?: string; category?: string; withSignature?: boolean }) => {
    const path = '/api/repos/rs/r/commits/abc123/complete'
    const reason = opts?.reason ?? 'Upload of plate run 42'
    const category = opts?.category ?? 'data_correction'
    const session = await iso.sessionHeaders(writer)
    if (!opts?.withSignature) {
      return app.request(path, { method: 'POST', headers: session })
    }
    const signed = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path,
      body: {},
      reason,
      category,
    })
    // Signature only — reason comes from the prior /auth/reason declaration.
    return app.request(path, {
      method: 'POST',
      headers: {
        ...session,
        'x-mice-signature-id': signed['x-mice-signature-id']!,
      },
    })
  }

  await it('applies to the caller\'s next mutations until it expires', async () => {
    const clock = fakeClock()
    const restoreClock = useClock(clock)
    try {
      assert.equal((await pushLike()).status, 400)
      assert.equal((await declare('Upload of plate run 42', 60)).status, 200)
      assert.equal((await pushLike({ withSignature: true })).status, 200)
      const o = (await outcomes()).at(-1)!
      assert.deepEqual([o.reason, o.reason_source, o.category], ['Upload of plate run 42', 'explicit', 'data_correction'])
      clock.advance(61_000)
      assert.equal((await pushLike({ withSignature: true })).status, 400)
    } finally {
      restoreClock()
    }
  })

  await it('is validated like any other reason and never shared with another principal', async () => {
    // A fake clock earlier than now makes the declaration lapse as soon as the real clock returns.
    const restoreClock = useClock(fakeClock())
    after(restoreClock)
    assert.equal((await declare('short')).status, 400)
    assert.equal((await declare('Upload of plate run 42')).status, 200)
    const other = iso.person('someone-else')
    await preparePrincipal(other)
    await iso.grantRole(other, 'user')
    await setRepoCollaborator('rs', 'r', other, 'write')
    const res = await app.request('/api/repos/rs/r/commits/abc123/complete', {
      method: 'POST',
      headers: await iso.sessionHeaders(other),
    })
    assert.equal(res.status, 400)
  })
})

await describe('reason in the audit views', async () => {
  await it('shows reason, source and category in the CSV export', async () => {
    const path = '/api/repos/rs/r/branches/old'
    const signed = await regulatedMutationHeaders(admin, {
      method: 'DELETE',
      path,
      body: {},
      reason: 'Correct the plate layout',
      category: 'data_correction',
    })
    await app.request(path, {
      method: 'DELETE',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        ...signed,
        'x-mice-change-control-id': 'CC-2026-114',
      },
    })
    const csv = await (await app.request('/auth/audit/export.csv', { headers: await iso.sessionHeaders(admin) })).text()
    const [header, ...lines] = csv.trim().split('\r\n')
    const cols = header!.split(',')
    const row = lines.find((l) => l.includes('branch.delete'))!
    assert.ok(cols.includes('reason') && cols.includes('reason_source') && cols.includes('category'))
    assert.match(row, /Correct the plate layout,explicit,data_correction/)
  })
})
