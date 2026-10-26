import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { fakeClock, useClock } = await import('./clock.js')
const { overrideEnv } = await import('./env.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { createPat } = await import('./authentication/credentials/tokens.js')
const { createServicePrincipal, serviceUser } = await import('./authentication/credentials/servicePrincipals.js')

const ledger = await openLedger(immudbConfig())
let since = 0
const admin = iso.admin
await preparePrincipal(admin)
const writer = iso.person('reason-writer')
await createNamespaceAuthz(admin, 'rs', 'none', true)
await setRepoCollaborator('rs', 'r', writer, 'write')
await preparePrincipal(writer)

type Row = {
  id: string
  action: string
  phase?: string
  status: number
  message?: string
  reason?: string
  reason_source?: string
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
  await it('rejects a too-short commit message with 400 before anything reaches oxen', async () => {
    const res = await putJson('fix a')
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { status_message: string }).status_message, 'reason_too_short')
    assert.equal(upstream.length, 0)
    assert.equal((await rows()).some((r) => r.phase === 'intent'), false)
  })

  await it('rejects a mutation with neither commit message nor reason', async () => {
    const res = await putJson(undefined)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { status_message: string }).status_message, 'reason_required')
    assert.equal(upstream.length, 0)
  })

  await it('uses a long-enough commit message as the reason and records its source', async () => {
    const res = await putJson('Correct the plate layout')
    assert.equal(res.status, 200)
    const o = (await outcomes())[0]!
    assert.equal(o.reason, 'Correct the plate layout')
    assert.equal(o.reason_source, 'commit-message')
    assert.equal(o.message, 'Correct the plate layout')
  })

  await it('lets an explicit X-Mice-Reason override the commit message and stores both', async () => {
    const res = await putJson('fix a', { 'x-mice-reason': 'Instrument recalibrated, see deviation 12' })
    assert.equal(res.status, 200)
    const o = (await outcomes())[0]!
    assert.equal(o.reason, 'Instrument recalibrated, see deviation 12')
    assert.equal(o.reason_source, 'explicit')
    assert.equal(o.message, 'fix a')
    assert.equal(upstream[0]!.headers.get('x-mice-reason'), null)
  })

  await it('rejects an explicit reason that is too short', async () => {
    const res = await putJson('Correct the plate layout', { 'x-mice-reason': 'oops' })
    assert.equal(res.status, 400)
    assert.equal(upstream.length, 0)
  })

  await it('takes the minimum length from one setting', async () => {
    const restore = overrideEnv({ auditReasonMinLength: 30 })
    try {
      assert.equal((await putJson('Correct the plate layout')).status, 400)
    } finally {
      restore()
    }
    assert.equal((await putJson('Correct the plate layout')).status, 200)
  })

  await it('applies to binary-bodied writes through the header, and to a bodiless branch delete', async () => {
    const del = await app.request('/api/repos/rs/r/branches/old', {
      method: 'DELETE',
      headers: await iso.sessionHeaders(admin),
    })
    assert.equal(del.status, 400)
    const ok = await app.request('/api/repos/rs/r/branches/old', {
      method: 'DELETE',
      headers: { ...(await iso.sessionHeaders(admin)), 'x-mice-reason': 'Branch merged and obsolete' },
    })
    assert.equal(ok.status, 200)
    assert.equal((await outcomes())[0]!.reason_source, 'explicit')
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
  ...(reason ? { 'x-mice-reason': reason } : {}),
})

await describe('mandatory reason on admin and permission changes', async () => {
  await it('rejects a namespace create without a reason and changes nothing', async () => {
    const res = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: await adminHeaders(),
      body: JSON.stringify({ name: 'newns', basePermission: 'none' }),
    })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { code: string }).code, 'reason_required')
    assert.equal((await rows()).some((r) => r.phase === 'intent'), false)
    const ok = await app.request('/auth/namespaces', {
      method: 'POST',
      headers: await adminHeaders('Set up the proteomics namespace'),
      body: JSON.stringify({ name: 'newns', basePermission: 'none' }),
    })
    assert.equal(ok.status, 200)
    const o = (await outcomes()).find((r) => r.action === 'namespace.create')!
    assert.equal(o.reason, 'Set up the proteomics namespace')
    assert.equal(o.reason_source, 'explicit')
  })

  await it('applies to instance admin changes and access-request decisions', async () => {
    const patch = await app.request('/auth/instance', {
      method: 'PATCH',
      headers: await adminHeaders(),
      body: JSON.stringify({ enforce: true }),
    })
    assert.equal(patch.status, 400)
    const decide = await app.request('/auth/access-requests/nope', {
      method: 'POST',
      headers: await adminHeaders(),
      body: JSON.stringify({ action: 'deny' }),
    })
    assert.equal(decide.status, 400)
  })

  await it('does not ask for a reason on token management', async () => {
    const res = await app.request('/auth/tokens', {
      method: 'POST',
      headers: await adminHeaders(),
      body: JSON.stringify({ label: 'laptop' }),
    })
    assert.equal(res.status, 200)
  })
})

await describe('service principal registered reason', async () => {
  await it('is stored at create and update, and used when a mutation carries no explicit reason', async () => {
    const created = await app.request('/auth/instance/service-principals', {
      method: 'POST',
      headers: await adminHeaders('Register the nightly ingest job'),
      body: JSON.stringify({ name: 'ingest', owner: writer, reason: 'x' }),
    })
    assert.equal(created.status, 400)
    const ok = await app.request('/auth/instance/service-principals', {
      method: 'POST',
      headers: await adminHeaders('Register the nightly ingest job'),
      body: JSON.stringify({ name: 'ingest', owner: writer, reason: 'Nightly instrument ingest' }),
    })
    assert.equal(ok.status, 201)
    const { servicePrincipal } = (await ok.json()) as { servicePrincipal: { id: string; reason: string } }
    assert.equal(servicePrincipal.reason, 'Nightly instrument ingest')
    await setRepoCollaborator('rs', 'r', serviceUser(servicePrincipal as never), 'write')
    const { token } = await createPat(serviceUser(servicePrincipal as never), 'ci')
    const call = (extra: Record<string, string> = {}) =>
      app.request('/api/repos/rs/r/file/main/b.csv', {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra },
        body: '{"message":"x"}',
      })
    assert.equal((await call()).status, 200)
    const o = (await outcomes()).at(-1)!
    assert.deepEqual([o.reason, o.reason_source], ['Nightly instrument ingest', 'registered'])
    await call({ 'x-mice-reason': 'One-off backfill after outage' })
    assert.equal((await outcomes()).at(-1)!.reason_source, 'explicit')

    const patched = await app.request(`/auth/instance/service-principals/${servicePrincipal.id}`, {
      method: 'PATCH',
      headers: await adminHeaders('Job renamed after the migration'),
      body: JSON.stringify({ reason: 'Nightly ingest, new instrument' }),
    })
    assert.equal(patched.status, 200)
    await call()
    assert.equal((await outcomes()).at(-1)!.reason, 'Nightly ingest, new instrument')
  })

  await it('is refused when the principal has no registered reason and sends none', async () => {
    const r = await createServicePrincipal({ name: 'bare', owner: writer })
    assert.equal(r.ok, true)
    if (!r.ok) return
    await setRepoCollaborator('rs', 'r', serviceUser(r.principal), 'write')
    const { token } = await createPat(serviceUser(r.principal), 'ci')
    const res = await app.request('/api/repos/rs/r/file/main/c.csv', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{"message":"a long enough commit message"}',
    })
    assert.equal(res.status, 400)
    assert.equal(upstream.length, 0)
  })
})

await describe('declared reason for clients that cannot send a header', async () => {
  const declare = async (reason: string, ttlSec?: number) =>
    app.request('/auth/reason', {
      method: 'POST',
      headers: { ...(await iso.sessionHeaders(writer)), 'content-type': 'application/json' },
      body: JSON.stringify({ reason, ttlSec }),
    })
  const pushLike = async () =>
    app.request('/api/repos/rs/r/commits/abc123/complete', {
      method: 'POST',
      headers: await iso.sessionHeaders(writer),
    })

  await it('applies to the caller\'s next mutations until it expires', async () => {
    const clock = fakeClock()
    const restoreClock = useClock(clock)
    try {
      assert.equal((await pushLike()).status, 400)
      assert.equal((await declare('Upload of plate run 42', 60)).status, 200)
      assert.equal((await pushLike()).status, 200)
      const o = (await outcomes()).at(-1)!
      assert.deepEqual([o.reason, o.reason_source], ['Upload of plate run 42', 'explicit'])
      clock.advance(61_000)
      assert.equal((await pushLike()).status, 400)
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
    await setRepoCollaborator('rs', 'r', other, 'write')
    const res = await app.request('/api/repos/rs/r/commits/abc123/complete', {
      method: 'POST',
      headers: await iso.sessionHeaders(other),
    })
    assert.equal(res.status, 400)
  })
})

await describe('reason in the audit views', async () => {
  await it('shows reason and its source in the CSV export', async () => {
    await putJson('Correct the plate layout')
    const csv = await (await app.request('/auth/audit/export.csv', { headers: await iso.sessionHeaders(admin) })).text()
    const [header, ...lines] = csv.trim().split('\r\n')
    const cols = header!.split(',')
    const row = lines.find((l) => l.includes('file.write'))!
    assert.ok(cols.includes('reason') && cols.includes('reason_source'))
    assert.match(row, /Correct the plate layout,commit-message/)
  })
})
