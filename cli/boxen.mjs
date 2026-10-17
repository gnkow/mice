#!/usr/bin/env node
/**
 * Boxen CLI — wraps the Oxen CLI against the auth BFF, plus login/logout/whoami.
 *
 *   boxen login [--remote URL] [--no-open]
 *   boxen logout
 *   boxen whoami
 *   boxen remote
 *   boxen version
 *   boxen <oxen-subcommand> …   # full Oxen parity via PATH `oxen`
 */
import {
  authHostFromRemote,
  resolveRemote,
  resolveToken,
} from './lib/config.mjs'
import { cmdLogin, cmdLogout, cmdWhoami } from './lib/login.mjs'
import {
  ensureOxenAuth,
  findOxen,
  looksLikeDirectOxenServer,
  oxenVersion,
  rewriteArgsForBff,
  runOxen,
} from './lib/oxen.mjs'

const BOXEN_VERSION = '0.1.0'

function printHelp() {
  console.log(`boxen ${BOXEN_VERSION} — Oxen CLI via the Boxen auth BFF

Usage:
  boxen login [--remote URL] [--no-open]
  boxen logout
  boxen whoami
  boxen remote
  boxen version
  boxen <oxen command> [args…]

Environment:
  BOXEN_REMOTE   BFF base URL (default http://localhost:8080 or last login)
  BOXEN_PAT      Use this PAT instead of boxen login (CI)

All Oxen subcommands are forwarded to the oxen binary on PATH after
credentials are applied for the BFF host. Do not point remotes at :3001.
`)
}

function parseLoginFlags(argv) {
  /** @type {{ remote?: string, open: boolean }} */
  const opts = { open: true }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remote' && argv[i + 1]) {
      opts.remote = argv[++i]
    } else if (a.startsWith('--remote=')) {
      opts.remote = a.slice('--remote='.length)
    } else if (a === '--no-open') {
      opts.open = false
    } else if (a === '--help' || a === '-h') {
      printHelp()
      process.exit(0)
    } else {
      rest.push(a)
    }
  }
  return { opts, rest }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return
  }

  const cmd = argv[0]

  if (cmd === 'login') {
    const { opts } = parseLoginFlags(argv.slice(1))
    await cmdLogin(opts)
    return
  }
  if (cmd === 'logout') {
    const { opts } = parseLoginFlags(argv.slice(1))
    await cmdLogout(opts)
    return
  }
  if (cmd === 'whoami') {
    const { opts } = parseLoginFlags(argv.slice(1))
    await cmdWhoami(opts)
    return
  }
  if (cmd === 'remote') {
    const remote = resolveRemote()
    console.log(remote)
    console.log(`auth host: ${authHostFromRemote(remote)}`)
    const token = resolveToken()
    console.log(token ? 'credentials: present' : 'credentials: none')
    return
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-V') {
    console.log(`boxen ${BOXEN_VERSION}`)
    const ov = oxenVersion()
    if (ov) console.log(`oxen ${ov}`)
    else console.log('oxen: not found on PATH')
    return
  }
  if (cmd === 'help') {
    printHelp()
    return
  }

  // --- Oxen passthrough ---
  const remote = resolveRemote()
  if (looksLikeDirectOxenServer(remote)) {
    console.error(
      `boxen: BOXEN_REMOTE / configured remote looks like raw oxen-server (${remote}).\nUse the auth BFF remote (e.g. http://localhost:8080), not :3001.`,
    )
    process.exitCode = 1
    return
  }

  try {
    ensureOxenAuth(remote)
  } catch (err) {
    console.error(`boxen: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  const { args, rewritten, blocked } = rewriteArgsForBff(argv, remote)
  if (blocked) {
    console.error(`boxen: could not rewrite direct oxen-server URL: ${blocked}`)
    process.exitCode = 1
    return
  }
  if (rewritten) {
    console.error(`boxen: rewrote :3001 remote URL(s) to ${remote}`)
  }

  // Soft check: clone without scheme might still hit wrong host via oxen defaults —
  // we only rewrite absolute http(s) args.
  const code = await runOxen(args)
  process.exitCode = code
}

main().catch((err) => {
  console.error('boxen:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
