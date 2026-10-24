import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it, mock } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-audit-'))
process.env.AUTH_DATA_DIR = dataDir

const {
  appendAudit,
  classifyPath,
  setAuditObserver,
  auditEventsToCsv,
  auditFacets,
  csvCell,
  queryAudit,
  queryAuditForExport,
} = await import('./audit.js')
const { auditActionLabel, auditActionInfo, knownAuditActions } = await import(
  './auditLabels.js'
)

const actor = { sub: 's1', email: 'a@x.io', name: 'Ann', iss: 'iss' }

function add(
  action: string,
  extra: {
    namespace?: string
    repo?: string
    detail?: Record<string, unknown>
    message?: string
  } = {},
) {
  appendAudit({
    actor,
    via: 'session',
    method: 'POST',
    path: '/x',
    status: 200,
    action,
    ...extra,
  })
}

add('session.create', {
  namespace: 'ns1',
  detail: { session_id: 'sess-1', mounts: [{ workspace_id: 'ws-m' }] },
})
add('session.retry', { namespace: 'ns1', detail: { session_id: 'sess-2' } })
add('workspace.commit', { namespace: 'ns1', repo: 'r', detail: { workspace_id: 'ws-1' } })
add('file.write', { namespace: 'ns2', repo: 'r2', detail: { workspace_id: 'ws-2' } })
add('job.create', { namespace: 'ns1', repo: 'r', detail: { job_id: 'job-1' } })
add('job.sync', { namespace: 'ns2', detail: { job_ids: ['job-2', 'job-3'] } })
add('repo.create', { namespace: 'ns1', repo: 'r', message: '=HYPERLINK("x")' })

after(() => rmSync(dataDir, { recursive: true, force: true }))

describe('audit filters', () => {
  it('filters by session id, including mounts for workspace', () => {
    const s = queryAudit({ sessionId: 'sess-1' }).events
    assert.deepEqual(s.map((e) => e.action), ['session.create'])
    const w = queryAudit({ workspaceId: 'ws-m' }).events
    assert.deepEqual(w.map((e) => e.action), ['session.create'])
    assert.equal(queryAudit({ workspaceId: 'ws-1' }).events.length, 1)
  })

  it('filters by job id including batch job_ids', () => {
    assert.equal(queryAudit({ jobId: 'job-1' }).events.length, 1)
    const b = queryAudit({ jobId: 'job-3' }).events
    assert.deepEqual(b.map((e) => e.action), ['job.sync'])
  })

  it('applies allowedNamespaces before paging', () => {
    const r = queryAudit({ allowedNamespaces: ['ns2'], limit: 2 })
    assert.equal(r.events.length, 2)
    assert.ok(r.events.every((e) => e.namespace === 'ns2'))
    assert.equal(queryAudit({ allowedNamespaces: [] }).events.length, 0)
  })

  it('action prefix groups but exact action does not widen', () => {
    assert.equal(queryAudit({ action: 'session' }).events.length, 2)
    assert.equal(queryAudit({ action: 'session.retry' }).events.length, 1)
  })

  it('combines filters', () => {
    assert.equal(
      queryAudit({ namespace: 'ns1', jobId: 'job-2' }).events.length,
      0,
    )
  })
})

describe('audit facets', () => {
  it('lists distinct sessions, workspaces and jobs', () => {
    const f = auditFacets({})
    assert.deepEqual(f.sessions.map((s) => s.id).sort(), ['sess-1', 'sess-2'])
    assert.deepEqual(f.workspaces.map((s) => s.id).sort(), ['ws-1', 'ws-2', 'ws-m'])
    assert.deepEqual(f.jobs.map((s) => s.id).sort(), ['job-1', 'job-2', 'job-3'])
    assert.equal(f.jobs.find((j) => j.id === 'job-1')?.repo, 'r')
  })

  it('respects namespace scope', () => {
    const f = auditFacets({ allowedNamespaces: ['ns2'] })
    assert.deepEqual(f.sessions, [])
    assert.deepEqual(f.jobs.map((s) => s.id).sort(), ['job-2', 'job-3'])
  })
})

describe('audit CSV', () => {
  it('quotes and guards formula injection', () => {
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('=1+1'), "'=1+1")
    assert.equal(csvCell('-5'), "'-5")
    assert.equal(csvCell(undefined), '')
    assert.equal(csvCell(200), '200')
  })

  it('exports filtered rows with header and labels', () => {
    const { events } = queryAuditForExport({ jobId: 'job-2' })
    const csv = auditEventsToCsv(events)
    const lines = csv.trim().split('\r\n')
    assert.ok(lines[0].startsWith('timestamp,actor_name'))
    assert.equal(lines.length, 2)
    assert.ok(lines[1].includes('job.sync'))
    assert.ok(lines[1].includes('job-2;job-3'))
  })

  it('neutralises formulas in messages', () => {
    const { events } = queryAuditForExport({ action: 'repo.create' })
    assert.ok(auditEventsToCsv(events).includes(`"'=HYPERLINK(""x"")"`))
  })
})

describe('audit labels', () => {
  it('has labels for known actions and a fallback', () => {
    assert.equal(auditActionLabel('audit.export'), 'Audit log exported')
    assert.equal(auditActionInfo('weird.new_thing').group, 'Other')
    assert.ok(auditActionLabel('weird.new_thing').length > 0)
    const all = knownAuditActions()
    assert.equal(new Set(all.map((a) => a.value)).size, all.length)
  })
})

describe('notification audit integration', () => {
    it('classifies completed pushes but not intermediate commit uploads', () => {
      assert.deepEqual(classifyPath('POST', '/api/repos/ns/repo/commits/abc/complete'), {
        action: 'commit.publish',
        namespace: 'ns',
        repo: 'repo',
        detail: { commit_id: 'abc' },
      })
      assert.equal(classifyPath('POST', '/api/repos/ns/repo/commits/upload').action, 'other')
      assert.equal(classifyPath('POST', '/api/repos/ns/repo/commits/abc').action, 'other')
    })

    it('projects appended events and exposes them for durable replay', () => {
      let observed: string | undefined
      setAuditObserver((event) => {
        observed = event.id
      })
      const event = appendAudit({
        actor,
        via: 'session',
        method: 'POST',
        path: '/x',
        status: 200,
        action: 'commit.publish',
      })
      assert.ok(event)
      assert.equal(observed, event.id)
      assert.ok(queryAudit({ action: 'commit.publish' }).events.some((e) => e.id === event.id))
      setAuditObserver(() => {})
  })

  it('does not lose the journaled event if live projection throws', () => {
    const logging = mock.method(console, 'error', () => {})
    setAuditObserver(() => { throw new Error('notification store unavailable') })
    try {
      const event = appendAudit({
        actor,
        via: 'session',
        method: 'POST',
        path: '/x',
        status: 200,
        action: 'file.write',
      })
      assert.ok(event)
      assert.equal(logging.mock.callCount(), 1)
      assert.ok(queryAudit({ action: 'file.write' }).events.some((entry) => entry.id === event.id))
    } finally {
      setAuditObserver(() => {})
      logging.mock.restore()
    }
  })
})

describe('namespace-scoped audit (Owner scope)', () => {
  it('never returns other namespaces or events without a namespace', () => {
    add('access_request.create', { message: 'no namespace' })
    const scope = ['ns1']
    const { events } = queryAudit({ allowedNamespaces: scope, limit: 100 })
    assert.ok(events.length > 0)
    assert.ok(events.every((e) => e.namespace === 'ns1'))

    const exported = queryAuditForExport({ allowedNamespaces: scope })
    assert.ok(exported.events.length > 0)
    assert.ok(exported.events.every((e) => e.namespace === 'ns1'))
    assert.ok(!auditEventsToCsv(exported.events).includes('ns2'))

    const facets = auditFacets({ allowedNamespaces: scope })
    assert.ok(facets.jobs.every((j) => !['job-2', 'job-3'].includes(j.id)))
    assert.ok(facets.workspaces.every((w) => w.id !== 'ws-2'))
  })

  it('an explicit other-namespace filter inside the scope returns nothing', () => {
    const { events } = queryAudit({ allowedNamespaces: ['ns1'], namespace: 'ns2', limit: 100 })
    assert.deepEqual(events, [])
    const facets = auditFacets({ allowedNamespaces: ['ns1'], namespace: 'ns2' })
    assert.deepEqual(facets.jobs, [])
    assert.deepEqual(facets.workspaces, [])
  })
})
