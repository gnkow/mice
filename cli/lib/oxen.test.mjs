import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import {
  ensureOxenIdentity,
  looksLikeDirectOxenServer,
  oxenIdentityDir,
  readOxenIdentity,
  rewriteArgsForBff,
  runOxen,
  userConfigPath,
} from './oxen.mjs'

/** Keep LMDB under the workspace — OS temp dirs often deny oxen mmap. */
mkdirSync(join(process.cwd(), '.tmp'), { recursive: true })
const tmpRoot = mkdtempSync(join(process.cwd(), '.tmp', 'oxen-ident-'))
const prevMiceHome = process.env.MICE_HOME

before(() => {
  process.env.MICE_HOME = join(tmpRoot, 'mice-home')
})

beforeEach(() => {
  // Shared ~/.mice/oxen-config — reset between cases.
  rmSync(join(process.env.MICE_HOME, 'oxen-config'), {
    recursive: true,
    force: true,
  })
})

after(() => {
  if (prevMiceHome === undefined) delete process.env.MICE_HOME
  else process.env.MICE_HOME = prevMiceHome
  try {
    rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function oxenAvailable() {
  const r = spawnSync('oxen', ['--version'], { encoding: 'utf8' })
  return (r.status ?? 1) === 0
}

function isLmdbEnvError(text) {
  return /LMDB|Operation not permitted|os error 1/i.test(String(text || ''))
}

describe('readOxenIdentity / ensureOxenIdentity', () => {
  it('returns null when user_config.toml is missing', () => {
    const root = join(tmpRoot, 'missing')
    mkdirSync(root, { recursive: true })
    assert.equal(readOxenIdentity(root), null)
  })

  it('writes identity under ~/.mice/oxen-config from actor (not in clone)', () => {
    const root = join(tmpRoot, 'write-actor')
    mkdirSync(root, { recursive: true })
    const r = ensureOxenIdentity(root, {
      name: 'Job Actor',
      email: 'actor@mice.local',
    })
    assert.equal(r.ok, true)
    assert.equal(r.configured, true)
    assert.equal(r.name, 'Job Actor')
    assert.equal(r.email, 'actor@mice.local')
    assert.equal(r.oxenConfigDir, oxenIdentityDir(root))
    assert.ok(r.oxenConfigDir.startsWith(process.env.MICE_HOME))
    assert.ok(!r.oxenConfigDir.startsWith(root))
    assert.equal(
      readFileSync(userConfigPath(root), 'utf8'),
      'name = "Job Actor"\nemail = "actor@mice.local"\n',
    )
    assert.equal(existsSync(join(root, '.mice')), false)
  })

  it('defaults to mice@localhost when actor empty', () => {
    const root = join(tmpRoot, 'defaults')
    mkdirSync(root, { recursive: true })
    const r = ensureOxenIdentity(root, {})
    assert.equal(r.ok, true)
    assert.equal(r.name, 'mice')
    assert.equal(r.email, 'mice@localhost')
  })

  it('is a no-op when identity already present', () => {
    const root = join(tmpRoot, 'noop')
    mkdirSync(root, { recursive: true })
    mkdirSync(oxenIdentityDir(root), { recursive: true })
    writeFileSync(
      userConfigPath(root),
      'name = "Existing"\nemail = "ex@ample.com"\n',
      'utf8',
    )
    const r = ensureOxenIdentity(root, {
      name: 'Ignored',
      email: 'ignored@mice.local',
    })
    assert.equal(r.ok, true)
    assert.equal(r.configured, false)
    assert.equal(r.name, 'Existing')
    assert.equal(r.email, 'ex@ample.com')
  })

  it('migrates legacy <clone>/.mice/oxen-config into ~/.mice', () => {
    const root = join(tmpRoot, 'legacy-migrate')
    const legacyDir = join(root, '.mice', 'oxen-config')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(
      join(legacyDir, 'user_config.toml'),
      'name = "Legacy"\nemail = "legacy@mice.local"\n',
      'utf8',
    )
    const r = ensureOxenIdentity(root, {})
    assert.equal(r.ok, true)
    assert.equal(r.name, 'Legacy')
    assert.equal(r.email, 'legacy@mice.local')
    assert.ok(existsSync(userConfigPath(root)))
    assert.ok(userConfigPath(root).startsWith(process.env.MICE_HOME))
  })

  it('sanitizes quotes and newlines in actor fields', () => {
    const root = join(tmpRoot, 'sanitize')
    mkdirSync(root, { recursive: true })
    const r = ensureOxenIdentity(root, {
      name: 'Ann "Quotes"\nBad',
      email: 'ann@example.com',
    })
    assert.equal(r.ok, true)
    assert.equal(r.name, 'Ann  Quotes  Bad')
    assert.equal(readOxenIdentity(root)?.name, 'Ann  Quotes  Bad')
  })
})

describe('ensureOxenIdentity + oxen commit (live)', () => {
  it(
    'OXEN_CONFIG_DIR identity enables commit even with a stale ambient dir',
    { skip: !oxenAvailable() },
    () => {
      const stale = join(tmpRoot, 'stale-config')
      const root = join(tmpRoot, 'live-repo')
      mkdirSync(stale, { recursive: true })
      mkdirSync(root, { recursive: true })

      const ambient = { ...process.env, OXEN_CONFIG_DIR: stale }

      const init = runOxen(['init'], { cwd: root, env: ambient })
      if (isLmdbEnvError(init.stderr) || isLmdbEnvError(init.stdout)) {
        // Host/sandbox cannot mmap oxen LMDB — identity unit tests above still cover the fix.
        return
      }
      assert.equal(init.code, 0, init.stderr || init.stdout)
      writeFileSync(join(root, 'out.txt'), 'hello\n')
      const addR = runOxen(['add', 'out.txt'], { cwd: root, env: ambient })
      assert.equal(addR.code, 0, addR.stderr || addR.stdout)

      const fail = runOxen(['commit', '-m', 'should fail'], {
        cwd: root,
        env: ambient,
      })
      assert.notEqual(fail.code, 0)
      assert.match(`${fail.stderr}\n${fail.stdout}`, /not configured/i)

      const ident = ensureOxenIdentity(root, {
        name: 'Live Actor',
        email: 'live@mice.local',
      })
      assert.equal(ident.ok, true)
      assert.ok(existsSync(userConfigPath(root)))

      const ok = runOxen(['commit', '-m', 'mice-job test'], {
        cwd: root,
        env: ambient,
        oxenConfigDir: ident.oxenConfigDir,
      })
      if (isLmdbEnvError(ok.stderr) || isLmdbEnvError(ok.stdout)) {
        return
      }
      assert.equal(ok.code, 0, ok.stderr || ok.stdout)
      assert.match(`${ok.stdout}\n${ok.stderr}`, /commit/i)
    },
  )
})

describe('looksLikeDirectOxenServer', () => {
  it('detects :3001 in URLs and hosts', () => {
    assert.equal(looksLikeDirectOxenServer('http://localhost:3001'), true)
    assert.equal(looksLikeDirectOxenServer('http://127.0.0.1:3001/ns/r'), true)
    assert.equal(looksLikeDirectOxenServer('localhost:3001'), true)
    assert.equal(looksLikeDirectOxenServer('http://localhost:8080'), false)
    assert.equal(looksLikeDirectOxenServer('http://localhost:8080/ns/r'), false)
    assert.equal(looksLikeDirectOxenServer('not a url'), false)
  })
})

describe('rewriteArgsForBff', () => {
  it('rewrites :3001 clone URLs to BFF and preserves path', () => {
    const { args, rewritten } = rewriteArgsForBff(
      ['clone', 'http://localhost:3001/acme/data'],
      'http://localhost:8080',
    )
    assert.equal(rewritten, true)
    assert.deepEqual(args, ['clone', 'http://localhost:8080/acme/data'])
  })

  it('leaves BFF URLs and non-URL args alone', () => {
    const { args, rewritten } = rewriteArgsForBff(
      ['clone', 'http://localhost:8080/acme/data', '--shallow'],
      'http://localhost:8080',
    )
    assert.equal(rewritten, false)
    assert.deepEqual(args, [
      'clone',
      'http://localhost:8080/acme/data',
      '--shallow',
    ])
  })

  it('rewrites multiple URL args', () => {
    const { args, rewritten } = rewriteArgsForBff(
      [
        'remote',
        'add',
        'origin',
        'http://127.0.0.1:3001/ns/repo',
      ],
      'https://mice.example.com',
    )
    assert.equal(rewritten, true)
    assert.equal(args[3], 'https://mice.example.com/ns/repo')
  })
})
