// Real-stack W3 integration check (needs `docker compose up -d`, real Docker).
// Run from auth/: node scripts/ws-integration.mjs
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EncryptJWT } from 'jose'

const BFF = process.env.BFF ?? 'http://localhost:8080'
const OXEN = process.env.OXEN ?? 'http://localhost:3001'
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-change-me-mice-session-secret'
const ns = 'wsint'
const repo = `r${Date.now().toString(36)}`
const IMG = 'alpine:3.20'

let failed = 0
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`)
  if (!c) failed++
}
const sh = (args) => spawnSync('docker', args, { encoding: 'utf8' })

async function cookie() {
  const key = createHash('sha256').update(SECRET).digest()
  const t = await new EncryptJWT({ sub: 'ws-int', iss: 'mice-e2e', email: 'mice@example.com', name: 'WS Int', id_token: '', groups: [] })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .encrypt(key)
  return `mice_session=${t}`
}
const ck = await cookie()
const api = async (method, path, body) => {
  const r = await fetch(BFF + path, {
    method,
    headers: { Cookie: ck, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let wsId = null
let vol = null
try {
  await fetch(`${OXEN}/api/repos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: ns, name: repo }) })
  await put('README.md', 'hello\n')
  await put('keep.txt', 'keep me\n')
  await put('mod.txt', 'original\n')
  await put('gone.txt', 'delete me\n')
  await put('dir/a.txt', 'a\n')
  await put('dir/b.txt', 'b\n')

  const cr = await api('POST', '/auth/workspaces', { namespace: ns, repo, name: 'int', source: { branch: 'main' } })
  ok(cr.status === 202, `create → 202 (${cr.status})`)
  wsId = cr.json.workspace.id
  let ws
  for (let i = 0; i < 60; i++) {
    ws = (await api('GET', `/auth/workspaces/${wsId}`)).json.workspace
    if (ws.status !== 'preparing') break
    await sleep(500)
  }
  ok(ws.status === 'ready', `workspace ready (${ws.status} ${ws.last_error ?? ''})`)
  ok(ws.driver === 'overlay', `driver overlay (${ws.driver})`)
  ok(Array.isArray(ws.leases) && ws.writer === null, 'workspace JSON has leases[] and writer:null')

  const lowerTree = `/s/commits/${ns}/${repo}/${ws.lower_commit}/tree`
  const lowerSum = () => sh(['run', '--rm', '-v', 'mice-store:/s:ro', IMG, 'sh', '-c', `cd ${lowerTree} && find . -type f | sort | xargs sha256sum`]).stdout
  const lowerBefore = lowerSum()
  if (!lowerBefore) console.log('      lower path:', lowerTree)
  ok(lowerBefore.split('\n').filter(Boolean).length === 6, 'lower checkout has 6 files')

  const w = await api('POST', `/auth/workspaces/${wsId}/leases`, { mode: 'write', holder_kind: 'user', holder_label: 'integration' })
  ok(w.status === 201 && w.json.lease.mode === 'write' && !('owner_sub' in w.json.lease), `write lease → 201 (${w.status})`)
  const wl = w.json.lease
  const w2 = await api('POST', `/auth/workspaces/${wsId}/leases`, { mode: 'write' })
  ok(w2.status === 423 && w2.json.holder?.label === 'integration', `second write → 423 with holder (${w2.status})`)
  const rl = await api('POST', `/auth/workspaces/${wsId}/leases`, { mode: 'read', holder_kind: 'job', holder_label: 'reader' })
  ok(rl.status === 201, `read lease during write lease → 201 (${rl.status})`)
  const del423 = await api('DELETE', `/auth/workspaces/${wsId}`)
  ok(del423.status === 423, `delete workspace while leased → 423 (${del423.status})`)

  const mrw = await api('POST', `/auth/workspaces/${wsId}/leases/${wl.id}/mount`, { mode: 'rw', dest: '/work' })
  ok(mrw.status === 200 && mrw.json.mount.type === 'volume', `rw mount spec (${mrw.status})`)
  const wrongMode = await api('POST', `/auth/workspaces/${wsId}/leases/${rl.json.lease.id}/mount`, { mode: 'rw', dest: '/work' })
  ok(wrongMode.status === 403, `rw mount with read lease → 403 (${wrongMode.status})`)
  const mro = await api('POST', `/auth/workspaces/${wsId}/leases/${rl.json.lease.id}/mount`, { mode: 'ro', dest: '/work' })
  ok(mro.status === 200 && mro.json.mount.readonly === true, 'ro mount spec')
  vol = mrw.json.mount.source
  console.log('      mount:', JSON.stringify(mrw.json.mount))

  const script = [
    'set -e',
    'echo new > /work/added.txt',
    'echo changed > /work/mod.txt',
    'rm /work/gone.txt',
    'rm -r /work/dir && mkdir /work/dir && echo fresh > /work/dir/c.txt',
    'mkdir -p /work/newdir && echo n > /work/newdir/n.txt',
  ].join('; ')
  const run = sh(['run', '--rm', ...mrw.json.mount.docker_args, IMG, 'sh', '-c', script])
  ok(run.status === 0, `writer container ok ${run.stderr.trim()}`)

  const ch = (await api('GET', `/auth/workspaces/${wsId}/changes`)).json
  const names = (l) => l.map((x) => x.path).sort().join(',')
  console.log('      changes:', JSON.stringify(ch))
  ok(names(ch.added) === 'added.txt,dir/c.txt,newdir/n.txt', `added: ${names(ch.added)}`)
  ok(names(ch.modified) === 'mod.txt', `modified: ${names(ch.modified)}`)
  ok(names(ch.removed) === 'dir/a.txt,dir/b.txt,gone.txt', `removed (whiteouts + opaque dir): ${names(ch.removed)}`)
  ok(!ch.warnings?.length, `no degraded warnings (${JSON.stringify(ch.warnings ?? [])})`)
  ok(lowerSum() === lowerBefore, 'lower checkout untouched (I4)')

  const ro = sh(['run', '--rm', ...mro.json.mount.docker_args, IMG, 'sh', '-c',
    'test "$(cat /work/added.txt)" = new && test "$(cat /work/mod.txt)" = changed && test ! -e /work/gone.txt ' +
    '&& ! (echo x > /work/added.txt) 2>/dev/null && ! (echo x > /work/zzz) 2>/dev/null && ! rm /work/keep.txt 2>/dev/null && ! mkdir /work/q 2>/dev/null && ! touch /work/keep.txt 2>/dev/null'])
  ok(ro.status === 0, `ro container sees new files, all writes fail ${ro.stderr.trim()}`)

  const hashBefore = wl.upper_hash
  await api('DELETE', `/auth/workspaces/${wsId}/leases/${wl.id}`)
  const w3 = await api('POST', `/auth/workspaces/${wsId}/leases`, { mode: 'write' })
  ok(w3.status === 201 && w3.json.lease.upper_hash !== hashBefore, 'new write lease records a different upper_hash after changes')
  await api('DELETE', `/auth/workspaces/${wsId}/leases/${w3.json.lease.id}`)
  await api('DELETE', `/auth/workspaces/${wsId}/leases/${rl.json.lease.id}`)
  ok((await api('GET', `/auth/workspaces/${wsId}/leases`)).json.leases.length === 0, 'all leases released')

  const rm = sh(['volume', 'rm', vol])
  ok(rm.status === 0, `docker volume rm after release ${rm.stderr.trim()}`)
  vol = null
  const del = await api('DELETE', `/auth/workspaces/${wsId}`)
  ok(del.status === 200 || del.status === 204, `delete workspace (container-created files removable) → ${del.status}`)
  const gone = await api('GET', `/auth/workspaces/${wsId}`)
  ok(gone.status === 404, 'workspace gone')
  const dir = sh(['run', '--rm', '-v', 'mice-workspaces:/w:ro', IMG, 'sh', '-c', `test ! -e /w/${wsId}`])
  ok(dir.status === 0, 'workspace dir removed from volume')
  wsId = null
} catch (e) {
  failed++
  console.error('ERROR', e)
} finally {
  if (vol) sh(['volume', 'rm', '-f', vol])
  if (wsId) {
    const ls = (await api('GET', `/auth/workspaces/${wsId}/leases`)).json.leases ?? []
    for (const l of ls) await api('DELETE', `/auth/workspaces/${wsId}/leases/${l.id}`)
    await api('DELETE', `/auth/workspaces/${wsId}`)
  }
  await fetch(`${OXEN}/api/repos/${ns}/${repo}`, { method: 'DELETE' }).catch(() => undefined)
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
}
