/**
 * Local Docker job execution against a disposable work directory.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { diffSnapshots, snapshotTree } from './oxen.mjs'

const DOCKER = process.env.MICE_DOCKER_BIN || 'docker'

function runCmd(bin, args, opts = {}) {
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  })
  return {
    code: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  }
}

/** Copy clone working tree into workDir, excluding .oxen / .mice. */
export function materializeWorkCopy(repoRoot, workDir) {
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  const entries = readdirSync(repoRoot, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === '.oxen' || ent.name === '.mice') continue
    const src = join(repoRoot, ent.name)
    const dest = join(workDir, ent.name)
    cpSync(src, dest, { recursive: true, force: true })
  }
}

/** Copy changed paths from workDir back into repoRoot. */
export function applyOutputsToClone(repoRoot, workDir, paths) {
  for (const p of paths) {
    const src = join(workDir, p)
    const dest = join(repoRoot, p)
    if (!existsSync(src)) continue
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(src, dest, { recursive: true, force: true })
  }
}

export async function runDockerJob({
  jobId,
  image,
  command,
  args = [],
  workDir,
  workdir = '/data',
  cpu = '1',
  memory = '512m',
  timeoutSeconds = 3600,
  maxLogBytes = 2_000_000,
  envMap = {},
  logPath,
}) {
  const name = `mice-job-${jobId}`.slice(0, 63)
  runCmd(DOCKER, ['rm', '-f', name])

  mkdirSync(dirname(logPath), { recursive: true })
  writeFileSync(logPath, '', 'utf8')

  const before = snapshotTree(workDir)

  const dockerArgs = [
    'run',
    '--name',
    name,
    '--network',
    'none',
    '--rm=false',
    '-v',
    `${workDir}:/data`,
    '-w',
    workdir || '/data',
    `--memory=${memory}`,
    `--cpus=${cpu}`,
  ]
  for (const [k, v] of Object.entries(envMap)) {
    dockerArgs.push('-e', `${k}=${v}`)
  }
  dockerArgs.push(image, ...command, ...args)

  const logFd = openSync(logPath, 'a')
  let written = 0
  const onChunk = (buf) => {
    if (written >= maxLogBytes) return
    const slice =
      written + buf.length > maxLogBytes
        ? buf.subarray(0, maxLogBytes - written)
        : buf
    appendFileSync(logFd, slice)
    written += slice.length
  }

  const exitCode = await new Promise((resolve) => {
    const child = spawn(DOCKER, dockerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    const timer = setTimeout(() => {
      runCmd(DOCKER, ['kill', name])
      resolve(124)
    }, timeoutSeconds * 1000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const logs = runCmd(DOCKER, ['logs', name])
      if (logs.stdout || logs.stderr) {
        onChunk(Buffer.from(logs.stdout + logs.stderr))
      }
      runCmd(DOCKER, ['rm', '-f', name])
      resolve(code ?? 1)
    })
  })

  const after = snapshotTree(workDir)
  const diff = diffSnapshots(before, after)
  const changed = [...diff.added, ...diff.modified]

  let digest = null
  const inspect = runCmd(DOCKER, [
    'image',
    'inspect',
    '--format',
    '{{index .RepoDigests 0}}',
    image,
  ])
  if (inspect.code === 0 && inspect.stdout.trim()) {
    digest = inspect.stdout.trim()
  }

  return {
    exitCode,
    changed,
    removed: diff.removed,
    imageDigest: digest,
    before,
    after,
  }
}

export function pathHashesFromSnapshot(paths, snap) {
  return paths.map((path) => ({
    path,
    hash: String(snap.get(path) || ''),
  }))
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Pre-job paths whose basename/path appears in the job command/args. */
export function inferCommandInputPaths(before, command, args = []) {
  const cmdText = [...(command || []), ...(args || [])].join(' ')
  if (!cmdText.trim() || !(before instanceof Map)) return []
  return [...before.keys()].filter((p) => {
    const base = p.split('/').filter(Boolean).pop() || p
    if (cmdText.includes(p)) return true
    if (base.length < 2) return false
    const re = new RegExp(
      `(?:^|\\s|[/"'])${escapeRegExp(base)}(?:$|\\s|[/"'])`,
    )
    return re.test(cmdText)
  })
}

export function pullImage(image) {
  const r = runCmd(DOCKER, ['pull', image])
  if (r.code !== 0) {
    throw new Error(`docker pull failed: ${r.stderr || r.stdout}`)
  }
}
