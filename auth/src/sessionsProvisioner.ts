import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { env } from './env.js'
import type { DesktopSession, SessionsProvisionerKind } from './sessionsTypes.js'

export type ProvisionResult = {
  runtimeId: string
  endpoints: {
    rdp_host: string
    rdp_port: number
    container_name: string | null
  }
  imageDigest: string | null
}

export type SessionProvisioner = {
  kind: SessionsProvisionerKind
  provision: (session: DesktopSession) => Promise<ProvisionResult>
  stop: (session: DesktopSession) => Promise<void>
  destroy: (session: DesktopSession) => Promise<void>
  health: (session: DesktopSession) => Promise<'ready' | 'unhealthy'>
}

function runCmd(
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number; stdin?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: [opts?.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer =
      opts?.timeoutMs != null
        ? setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`command timed out: ${bin} ${args.join(' ')}`))
          }, opts.timeoutMs)
        : null
    child.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d) => {
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
    if (opts?.stdin != null && child.stdin) {
      child.stdin.end(opts.stdin)
    }
  })
}

/** linuxserver/rdesktop only has Unix user `abc`; CUSTOM_USER is ignored. */
export const DOCKER_RDESKTOP_USER = 'abc'

async function setGuestPassword(
  name: string,
  username: string,
  password: string,
): Promise<void> {
  const result = await runCmd(
    env.sessionsDockerBin,
    ['exec', '-i', name, 'chpasswd'],
    { stdin: `${username}:${password}\n`, timeoutMs: 30_000 },
  )
  if (result.code !== 0) {
    throw new Error(
      `failed to set guest password: ${result.stderr || result.stdout}`,
    )
  }
}

function containerName(session: DesktopSession): string {
  return `mice-sess-${session.id}`
}

let busyboxReady: Promise<void> | null = null

async function ensureBusybox(): Promise<void> {
  if (!busyboxReady) {
    busyboxReady = (async () => {
      const pull = await runCmd(
        env.sessionsDockerBin,
        ['pull', 'busybox:1.36'],
        { timeoutMs: 5 * 60 * 1000 },
      )
      if (pull.code !== 0) {
        throw new Error(
          `docker pull busybox:1.36 failed: ${pull.stderr || pull.stdout}`,
        )
      }
    })().catch((err) => {
      busyboxReady = null
      throw err
    })
  }
  await busyboxReady
}

async function waitForRdp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  await ensureBusybox()
  const start = Date.now()
  let portOpenAt: number | null = null
  while (Date.now() - start < timeoutMs) {
    try {
      const { code } = await runCmd(
        env.sessionsDockerBin,
        [
          'run',
          '--rm',
          '--network',
          env.sessionsDockerNetwork,
          'busybox:1.36',
          'sh',
          '-c',
          `nc -z -w 2 ${host} ${port}`,
        ],
        { timeoutMs: 20_000 },
      )
      if (code === 0) {
        // xrdp opens 3389 before sesman/desktop are ready; wait a bit longer.
        if (portOpenAt == null) portOpenAt = Date.now()
        if (Date.now() - portOpenAt >= 8_000) return true
      } else {
        portOpenAt = null
      }
    } catch {
      portOpenAt = null
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

export function createDockerSessionProvisioner(): SessionProvisioner {
  return {
    kind: 'docker',
    async provision(session) {
      const name = containerName(session)
      console.log(`[sessions] provision ${session.id}: pull ${session.image}`)
      const pull = await runCmd(
        env.sessionsDockerBin,
        ['pull', session.image],
        { timeoutMs: 10 * 60 * 1000 },
      )
      if (pull.code !== 0) {
        throw new Error(
          `docker pull failed: ${pull.stderr || pull.stdout || 'unknown'}`,
        )
      }

      await runCmd(env.sessionsDockerBin, ['rm', '-f', name]).catch(() => {})

      const { workspaceDockerMounts } = await import('./sessionsWorkspaces.js')
      const wsMounts = await workspaceDockerMounts(session)

      const memory = session.resources.memory
      const cpus = session.resources.cpu
      // linuxserver/rdesktop: login is always Unix user `abc` (CUSTOM_USER is a
      // gclient/webtop var and does nothing here). seccomp=unconfined is required
      // for modern GUI apps under Docker.
      const args = [
        'run',
        '-d',
        '--name',
        name,
        '--network',
        env.sessionsDockerNetwork,
        '--security-opt',
        'seccomp=unconfined',
        '--label',
        `mice.session.id=${session.id}`,
        '--label',
        `mice.session.owner=${session.owner.sub}`,
        `--memory=${memory}`,
        `--cpus=${cpus}`,
        ...(wsMounts.env.some((e) => e.startsWith('PUID='))
          ? []
          : ['-e', 'PUID=1000', '-e', 'PGID=1000']),
        ...wsMounts.env.flatMap((e) => ['-e', e]),
      ]
      args.push(...wsMounts.args)
      args.push(session.image)

      console.log(`[sessions] provision ${session.id}: docker run ${name}`)
      const run = await runCmd(env.sessionsDockerBin, args, {
        timeoutMs: 2 * 60 * 1000,
      })
      if (run.code !== 0) {
        throw new Error(`docker run failed: ${run.stderr || run.stdout}`)
      }
      const runtimeId = run.stdout.trim() || name

      let digest: string | null = null
      try {
        const inspect = await runCmd(env.sessionsDockerBin, [
          'image',
          'inspect',
          '--format',
          '{{index .RepoDigests 0}}',
          session.image,
        ])
        digest = inspect.stdout.trim() || null
      } catch {
        digest = null
      }

      const rdpHost = name
      const rdpPort = 3389
      console.log(
        `[sessions] provision ${session.id}: wait for RDP ${rdpHost}:${rdpPort}`,
      )
      const ok = await waitForRdp(rdpHost, rdpPort, env.sessionsReadyTimeoutMs)
      if (!ok) {
        const logs = await runCmd(env.sessionsDockerBin, [
          'logs',
          '--tail',
          '40',
          name,
        ]).catch(() => ({ stdout: '', stderr: '' }))
        await runCmd(env.sessionsDockerBin, ['rm', '-f', name]).catch(() => {})
        throw new Error(
          `desktop RDP did not become ready in time (${env.sessionsReadyTimeoutMs}ms). logs: ${logs.stdout || logs.stderr || '(empty)'}`,
        )
      }

      console.log(
        `[sessions] provision ${session.id}: set password for ${DOCKER_RDESKTOP_USER}`,
      )
      await setGuestPassword(
        name,
        DOCKER_RDESKTOP_USER,
        session.guest_password,
      )

      console.log(`[sessions] provision ${session.id}: ready`)
      return {
        runtimeId,
        endpoints: {
          rdp_host: rdpHost,
          rdp_port: rdpPort,
          container_name: name,
        },
        imageDigest: digest,
      }
    },
    async stop(session) {
      const name = session.endpoints?.container_name || containerName(session)
      await runCmd(env.sessionsDockerBin, ['stop', '-t', '10', name]).catch(
        () => {},
      )
    },
    async destroy(session) {
      const name = session.endpoints?.container_name || containerName(session)
      await runCmd(env.sessionsDockerBin, ['rm', '-f', name]).catch(() => {})
    },
    async health(session) {
      const name = session.endpoints?.container_name || containerName(session)
      const inspect = await runCmd(env.sessionsDockerBin, [
        'inspect',
        '-f',
        '{{.State.Running}}',
        name,
      ])
      if (inspect.code !== 0 || inspect.stdout.trim() !== 'true') {
        return 'unhealthy'
      }
      const host = session.endpoints?.rdp_host || name
      const port = session.endpoints?.rdp_port || 3389
      const ok = await waitForRdp(host, port, 8_000)
      return ok ? 'ready' : 'unhealthy'
    },
  }
}

export function createLibvirtSessionProvisioner(): SessionProvisioner {
  return {
    kind: 'libvirt',
    async provision() {
      throw new Error(
        'libvirt provisioner requires virsh on the host; not available in this environment',
      )
    },
    async stop() {},
    async destroy() {},
    async health() {
      return 'unhealthy'
    },
  }
}

export function createKubevirtSessionProvisioner(): SessionProvisioner {
  return {
    kind: 'kubevirt',
    async provision() {
      throw new Error(
        'kubevirt provisioner requires kubectl + VirtualMachine API; not available in this environment',
      )
    },
    async stop() {},
    async destroy() {},
    async health() {
      return 'unhealthy'
    },
  }
}

export function createMockSessionProvisioner(): SessionProvisioner {
  return {
    kind: 'mock',
    async provision(session) {
      return {
        runtimeId: `mock-${session.id}`,
        endpoints: {
          rdp_host: `mock-${session.id}`,
          rdp_port: 3389,
          container_name: `mice-sess-${session.id}`,
        },
        imageDigest: 'sha256:mock',
      }
    },
    async stop() {},
    async destroy() {},
    async health() {
      return 'ready'
    },
  }
}

export function getSessionProvisioner(
  kind: SessionsProvisionerKind = env.sessionsProvisioner,
): SessionProvisioner {
  if (kind === 'mock') return createMockSessionProvisioner()
  if (kind === 'libvirt') return createLibvirtSessionProvisioner()
  if (kind === 'kubevirt') return createKubevirtSessionProvisioner()
  if (!existsSync(env.sessionsDockerSocket) && process.platform !== 'darwin') {
    console.warn(
      `[sessions] docker socket ${env.sessionsDockerSocket} missing; provision may fail`,
    )
  }
  return createDockerSessionProvisioner()
}
