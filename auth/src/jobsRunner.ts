import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, openSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './env.js'
import type { JobRun } from './jobsTypes.js'

const here = dirname(fileURLToPath(import.meta.url))

export type RunnerStartResult = {
  runtimeId: string
  /** Host process watching the container (for local docker). */
  wait: Promise<{ exitCode: number }>
  cancel: () => Promise<void>
}

export type Runner = {
  name: 'docker' | 'kubernetes'
  pullAndValidateImage: (image: string) => Promise<string | null>
  start: (opts: {
    job: JobRun
    dataDir: string
    logPath: string
  }) => Promise<RunnerStartResult>
}

function imageRegistryHost(image: string): string {
  const first = image.split('/')[0] ?? ''
  return first.includes('.') || first.includes(':') || first === 'localhost'
    ? first
    : 'docker.io'
}

export function assertImageAllowlisted(image: string): void {
  const allow = env.jobsImagePullAllowlist
  if (!allow.length) return
  const host = imageRegistryHost(image)
  if (!allow.some((a) => host === a || host.endsWith(`.${a}`))) {
    throw new Error(
      `Image registry "${host}" not in JOBS_IMAGE_PULL_ALLOWLIST`,
    )
  }
}

/**
 * Map a path under JOBS_DATA_DIR (container) to JOBS_HOST_DATA_DIR for
 * `docker run -v` against the host Docker engine.
 */
export function toDockerHostPath(containerPath: string): string {
  const hostRoot = env.jobsHostDataDir
  if (!hostRoot) return containerPath
  const containerRoot = env.jobsDataDir
  if (
    containerPath === containerRoot ||
    containerPath.startsWith(`${containerRoot}/`)
  ) {
    return `${hostRoot}${containerPath.slice(containerRoot.length)}`
  }
  return containerPath
}

function runCmd(
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer =
      opts?.timeoutMs != null
        ? setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`command timed out: ${bin} ${args.join(' ')}`))
          }, opts.timeoutMs)
        : null
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export function createDockerRunner(): Runner {
  return {
    name: 'docker',
    async pullAndValidateImage(image: string) {
      assertImageAllowlisted(image)
      if (!existsSync(env.jobsDockerSocket) && process.platform !== 'darwin') {
        // On macOS the socket path differs; still try docker CLI.
      }
      const pull = await runCmd(env.jobsDockerBin, ['pull', image], {
        timeoutMs: 10 * 60 * 1000,
      })
      if (pull.code !== 0) {
        throw new Error(`docker pull failed: ${pull.stderr || pull.stdout}`)
      }
      const inspect = await runCmd(env.jobsDockerBin, [
        'image',
        'inspect',
        '--format',
        '{{index .RepoDigests 0}}',
        image,
      ])
      const digest = inspect.stdout.trim()
      return digest || null
    },
    async start({ job, dataDir, logPath }) {
      const name = `boxen-job-${job.id}`
      // Remove any leftover
      await runCmd(env.jobsDockerBin, ['rm', '-f', name]).catch(() => {})

      const memory = job.resources.memory
      const cpus = job.resources.cpu
      const hostDataDir = toDockerHostPath(dataDir)
      if (!env.jobsHostDataDir) {
        console.warn(
          '[jobs] JOBS_HOST_DATA_DIR unset; docker -v uses container path (fails on Docker Desktop)',
        )
      }
      const args = [
        'run',
        '--name',
        name,
        '--network',
        'none',
        '--rm=false',
        '-v',
        `${hostDataDir}:/data`,
        '-w',
        job.workdir || '/data',
        `--memory=${memory}`,
        `--cpus=${cpus}`,
      ]
      for (const [k, v] of Object.entries(job.env)) {
        args.push('-e', `${k}=${v}`)
      }
      args.push(job.image)
      args.push(...job.command)
      if (job.args?.length) args.push(...job.args)

      writeFileSync(logPath, '', 'utf8')
      const logFd = openSync(logPath, 'a')

      const child = spawn(env.jobsDockerBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const max = job.max_log_bytes
      let written = 0
      const onChunk = (buf: Buffer) => {
        if (written >= max) return
        const slice =
          written + buf.length > max ? buf.subarray(0, max - written) : buf
        appendFileSync(logFd, slice)
        written += slice.length
      }
      child.stdout.on('data', onChunk)
      child.stderr.on('data', onChunk)

      let cancelled = false
      const wait = new Promise<{ exitCode: number }>((resolve) => {
        const timer = setTimeout(() => {
          void runCmd(env.jobsDockerBin, ['kill', name]).catch(() => {})
          resolve({ exitCode: 124 })
        }, job.timeout_seconds * 1000)

        child.on('close', async (code) => {
          clearTimeout(timer)
          // Capture remaining logs via docker logs if needed
          const logs = await runCmd(env.jobsDockerBin, ['logs', name]).catch(
            () => null,
          )
          if (logs && written < max) {
            const extra = Buffer.from(logs.stdout + logs.stderr)
            onChunk(extra)
          }
          await runCmd(env.jobsDockerBin, ['rm', '-f', name]).catch(() => {})
          resolve({ exitCode: cancelled ? 137 : (code ?? 1) })
        })
      })

      return {
        runtimeId: name,
        wait,
        cancel: async () => {
          cancelled = true
          await runCmd(env.jobsDockerBin, ['kill', name]).catch(() => {})
        },
      }
    },
  }
}

/**
 * Kubernetes runner: creates a batch/v1 Job with network isolated pod.
 * Requires kubectl + credentials. Phase 3 implementation.
 */
export function createKubernetesRunner(): Runner {
  return {
    name: 'kubernetes',
    async pullAndValidateImage(image: string) {
      assertImageAllowlisted(image)
      // Digest resolved at pull time by kubelet; store image ref for now.
      return null
    },
    async start({ job, dataDir, logPath }) {
      const name = `boxen-job-${job.id}`.slice(0, 63)
      const ns = env.jobsK8sNamespace
      const manifest = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name,
          namespace: ns,
          labels: { 'boxen.job': job.id },
        },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: job.timeout_seconds,
          template: {
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'job',
                  image: job.image,
                  command: job.command,
                  args: job.args,
                  env: Object.entries(job.env).map(([name, value]) => ({
                    name,
                    value,
                  })),
                  workingDir: job.workdir || '/data',
                  resources: {
                    limits: {
                      cpu: job.resources.cpu,
                      memory: job.resources.memory,
                    },
                  },
                  securityContext: { allowPrivilegeEscalation: false },
                  volumeMounts: [{ name: 'data', mountPath: '/data' }],
                },
              ],
              // hostPath for local/dev clusters that share the jobs work dir
              volumes: [
                {
                  name: 'data',
                  hostPath: { path: dataDir, type: 'Directory' },
                },
              ],
            },
          },
        },
      }

      writeFileSync(logPath, '', 'utf8')
      const applyProc = spawn(env.jobsKubectlBin, ['apply', '-f', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      applyProc.stdin.write(JSON.stringify(manifest))
      applyProc.stdin.end()
      const applyResult = await new Promise<{ code: number; err: string }>(
        (resolve) => {
          let err = ''
          applyProc.stderr.on('data', (d) => {
            err += String(d)
          })
          applyProc.on('close', (code) =>
            resolve({ code: code ?? 1, err }),
          )
        },
      )
      if (applyResult.code !== 0) {
        throw new Error(`kubectl apply failed: ${applyResult.err}`)
      }

      let cancelled = false
      const wait = (async () => {
        const deadline = Date.now() + job.timeout_seconds * 1000
        for (;;) {
          if (cancelled) return { exitCode: 137 }
          if (Date.now() > deadline) {
            await runCmd(env.jobsKubectlBin, [
              '-n',
              ns,
              'delete',
              'job',
              name,
              '--wait=false',
            ]).catch(() => {})
            return { exitCode: 124 }
          }
          const st = await runCmd(env.jobsKubectlBin, [
            '-n',
            ns,
            'get',
            'job',
            name,
            '-o',
            'jsonpath={.status.succeeded} {.status.failed}',
          ])
          const parts = st.stdout.trim().split(/\s+/)
          const succeeded = Number(parts[0] || 0)
          const failed = Number(parts[1] || 0)
          if (succeeded > 0) {
            const logs = await runCmd(env.jobsKubectlBin, [
              '-n',
              ns,
              'logs',
              `job/${name}`,
            ]).catch(() => ({ stdout: '', stderr: '', code: 1 }))
            appendFileSync(
              logPath,
              (logs.stdout || logs.stderr || '').slice(0, job.max_log_bytes),
            )
            return { exitCode: 0 }
          }
          if (failed > 0) {
            const logs = await runCmd(env.jobsKubectlBin, [
              '-n',
              ns,
              'logs',
              `job/${name}`,
            ]).catch(() => ({ stdout: '', stderr: '', code: 1 }))
            appendFileSync(
              logPath,
              (logs.stdout || logs.stderr || '').slice(0, job.max_log_bytes),
            )
            return { exitCode: 1 }
          }
          await new Promise((r) => setTimeout(r, 2000))
        }
      })()

      return {
        runtimeId: `${ns}/${name}`,
        wait,
        cancel: async () => {
          cancelled = true
          await runCmd(env.jobsKubectlBin, [
            '-n',
            ns,
            'delete',
            'job',
            name,
            '--wait=false',
          ]).catch(() => {})
        },
      }
    },
  }
}

export function getRunner(): Runner {
  if (env.jobsRunner === 'kubernetes') return createKubernetesRunner()
  return createDockerRunner()
}

/**
 * Resolve a host-side open/access watcher binary.
 * Prefers the static `boxen-readwatch` helper (no apk/inotify-tools needed).
 */
export function resolveReadWatchBin(): string | null {
  const arch =
    process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : ''
  const candidates = [
    join(here, '..', 'bin', `linux-${arch}`, 'boxen-readwatch'),
    '/usr/local/bin/boxen-readwatch',
    '/usr/bin/inotifywait',
    '/bin/inotifywait',
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

function isInotifyWait(bin: string): boolean {
  return bin.endsWith('inotifywait')
}

/** Host-side open/access watcher for observed read-set (Phase 0). */
export function startReadWatcher(
  dataDir: string,
): { stop: () => string[] } {
  const reads = new Set<string>()
  const bin = resolveReadWatchBin()
  if (!bin) {
    console.warn(
      '[jobs] no read-watcher binary (boxen-readwatch / inotifywait); inputs will be empty',
    )
    return { stop: () => [...reads] }
  }

  const args = isInotifyWait(bin)
    ? ['-m', '-r', '-e', 'open,access', '--format', '%w%f', dataDir]
    : [dataDir]

  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr?.on('data', (buf) => {
    const msg = String(buf).trim()
    if (msg) console.warn(`[jobs] read-watcher: ${msg}`)
  })
  child.stdout.on('data', (buf) => {
    for (const line of String(buf).split('\n')) {
      const full = line.trim()
      if (!full.startsWith(dataDir)) continue
      let rel = full.slice(dataDir.length).replace(/^\/+/, '')
      if (!rel || rel.startsWith('.boxen-job')) continue
      // directory events end with /
      if (rel.endsWith('/')) continue
      reads.add(rel)
    }
  })
  return {
    stop: () => {
      child.kill('SIGTERM')
      return [...reads]
    },
  }
}

export function matchGlobs(paths: string[], globs: string[]): string[] {
  if (!globs.length) return paths
  return paths.filter((p) => globs.some((g) => globMatch(g, p)))
}

/** Minimal ** / * glob matcher. */
function globMatch(pattern: string, path: string): boolean {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
  return new RegExp(`^${esc}$`).test(path)
}

export function resolveDigestFromDocker(image: string): Promise<string | null> {
  return runCmd(env.jobsDockerBin, [
    'image',
    'inspect',
    '--format',
    '{{index .RepoDigests 0}}',
    image,
  ])
    .then((r) => (r.code === 0 ? r.stdout.trim() || null : null))
    .catch(() => null)
}
