// Real-stack check: Mice workspace mounts in desktop sessions (docker provisioner).
// Needs `docker compose up -d` and the desktop image pulled. Run from auth/:
//   node scripts/ws-sessions-integration.mjs
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EncryptJWT } from 'jose'

const BFF = process.env.BFF ?? 'http://localhost:8080'
const OXEN = process.env.OXEN ?? 'http://localhost:3001'
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-change-me-mice-session-secret'
const ns = 'wssess'
const repo = `r${Date.now().toString(36)}`

let failed = 0
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`)
  if (!c) failed++
}
const sh = (args) => spawnSync('docker', args, { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const key = createHash('sha256').update(SECRET).digest()
const token = await new EncryptJWT({ sub: 'ws-sess', iss: 'mice-e2e', email: 'mice@example.com', name: 'WS Sess', id_token: '', groups: [] })
  .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
  .setIssuedAt()
  .setExpirationTime('1h')
  .encrypt(key)
const api = async (method, path, body) => {
  const r = await fetch(BFF + path, {
    method,
    headers: { Cookie: `mice_session=${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json }
}
async function put(path, content) {
  const f = new FormData()
  f.set('file', new Blob([content]), path.split('/').pop())
  f.set('name', 'seed'); f.set('email', 'seed@example.com'); f.set('message', `add ${path}`)
  const r = await fetch(`${OXEN}/api/repos/${ns}/${repo}/file/main/${path}`, { method: 'PUT', body: f })
  if (!r.ok) throw new Error(`seed ${path}: ${r.status} ${await r.text()}`)
}
async function waitSession(id, want, secs = 240) {
  let s
  for (let i = 0; i < secs; i++) {
    s = (await api('GET', `/auth/sessions/${id}`)).json.session
    if (s.status === want || s.status === 'failed') break
    await sleep(1000)
  }
  return s
}

const sessions = []
let wsId = null
try {
  await fetch(`${OXEN}/api/repos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: ns, name: repo }) })
  await put('README.md', 'hello\n')
  await put('mod.txt', 'original\n')
  await put('gone.txt', 'delete me\n')

  const cr = await api('POST', '/auth/workspaces', { namespace: ns, repo, name: 'sess-int', source: { branch: 'main' } })
  wsId = cr.json.workspace.id
  let ws
  for (let i = 0; i < 60; i++) {
    ws = (await api('GET', `/auth/workspaces/${wsId}`)).json.workspace
    if (ws.status !== 'preparing') break
    await sleep(500)
  }
  ok(ws.status === 'ready', `workspace ready (${ws.status})`)

  const a = await api('POST', '/auth/sessions', { mounts: [{ workspace_id: wsId, mount_mode: 'rw' }] })
  ok(a.status === 201 || a.status === 202, `create session A → ${a.status} ${JSON.stringify(a.json).slice(0, 200)}`)
  const sa = a.json.session
  sessions.push(sa.id)
  ok(sa.mounts[0].effective_mode === 'rw' && sa.mounts[0].lease_id, 'A effective_mode rw with lease_id')
  ok(JSON.stringify(sa.workspace_ids) === JSON.stringify([wsId]), 'A workspace_ids')

  const b = await api('POST', '/auth/sessions', { mounts: [{ workspace_id: wsId, mount_mode: 'rw' }] })
  const sb = b.json.session
  sessions.push(sb.id)
  ok(sb.mounts[0].effective_mode === 'ro' && sb.notices.length === 1, `B degraded to ro: ${sb.notices[0]}`)

  const del = await api('DELETE', `/auth/workspaces/${wsId}`)
  ok(del.status === 423 && /session/.test(del.json.error), `delete → 423 naming session: ${del.json.error}`)
  const cnt = (await api('GET', `/auth/workspaces/${wsId}`)).json.workspace
  ok(cnt.session_count === 2, `session_count 2 (${cnt.session_count})`)
  const filt = (await api('GET', `/auth/sessions?workspace_id=${wsId}`)).json.sessions
  ok(filt.length === 2, `?workspace_id filter returns 2 (${filt.length})`)

  const ra = await waitSession(sa.id, 'ready')
  ok(ra.status === 'ready', `A ready (${ra.status} ${ra.error ?? ''})`)
  const rb = await waitSession(sb.id, 'ready')
  ok(rb.status === 'ready', `B ready (${rb.status} ${rb.error ?? ''})`)

  const path = `/data/${ns}/${repo}`
  const ca = `mice-sess-${sa.id}`
  const cb = `mice-sess-${sb.id}`
  const write = sh(['exec', ca, 'sh', '-c', `echo new > ${path}/added.txt && echo changed > ${path}/mod.txt && rm ${path}/gone.txt`])
  ok(write.status === 0, `A writes through the mount ${write.stderr.trim()}`)
  const readB = sh(['exec', cb, 'sh', '-c', `cat ${path}/added.txt`])
  ok(readB.status === 0 && readB.stdout.trim() === 'new', 'B sees A\'s new file read-only')
  const writeB = sh(['exec', cb, 'sh', '-c', `echo x > ${path}/b.txt`])
  ok(writeB.status !== 0, 'B cannot write')
  const ch = (await api('GET', `/auth/workspaces/${wsId}/changes`)).json
  ok(ch.added?.some((f) => f.path === 'added.txt') && ch.modified?.some((f) => f.path === 'mod.txt') && ch.removed?.some((f) => f.path === 'gone.txt'), `changes: ${JSON.stringify(ch)}`)

  const stop = await api('POST', `/auth/sessions/${sa.id}/stop`)
  ok(stop.status === 200, `stop A → ${stop.status}`)
  const afterStop = (await api('GET', `/auth/workspaces/${wsId}`)).json.workspace
  ok(afterStop.writer === null && afterStop.leases.length === 1, 'A stop released the write lease')
  ok(sh(['inspect', ca]).status !== 0, 'A container removed')

  const rm = await api('POST', `/auth/sessions/${sb.id}/remount`, {})
  ok(rm.status === 200 && rm.json.session.mounts[0].effective_mode === 'rw', `B remounted rw (${rm.status})`)
  const rb2 = await waitSession(sb.id, 'ready')
  ok(rb2.status === 'ready', `B ready after remount (${rb2.status})`)
  const persisted = sh(['exec', cb, 'sh', '-c', `cat ${path}/added.txt && echo more > ${path}/b.txt`])
  ok(persisted.status === 0 && persisted.stdout.trim() === 'new', 'B rw sees persisted upper and can write')

  for (const id of sessions.splice(0)) await api('DELETE', `/auth/sessions/${id}`)
  const left = (await api('GET', `/auth/workspaces/${wsId}`)).json.workspace
  ok(left.leases.length === 0 && left.session_count === 0, 'destroy released all leases')
  const d2 = await api('DELETE', `/auth/workspaces/${wsId}`)
  ok(d2.status === 200 || d2.status === 204, `delete workspace → ${d2.status}`)
  wsId = null
} catch (e) {
  failed++
  console.error('ERROR', e)
} finally {
  for (const id of sessions) await api('DELETE', `/auth/sessions/${id}`).catch(() => undefined)
  if (wsId) {
    for (let i = 0; i < 20; i++) {
      const r = await api('DELETE', `/auth/workspaces/${wsId}`)
      if (r.status !== 423) break
      await sleep(1000)
    }
  }
  await fetch(`${OXEN}/api/repos/${ns}/${repo}`, { method: 'DELETE' }).catch(() => undefined)
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
}
