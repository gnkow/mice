#!/usr/bin/env node
/**
 * Run node:test files sequentially and stop on the first failing file.
 * (Node 26 has no --test-fail-fast; this is the project fail-fast harness.)
 *
 * Usage:
 *   node scripts/test-fail-fast.mjs [--tsx] <file> [file...]
 *   node scripts/test-fail-fast.mjs [--tsx] --dir <dir>
 *
 * --dir runs every *.test.ts / *.test.mjs under <dir> (sorted, skipping node_modules), so a
 * new test file is picked up without editing a package script. Finding none is an error.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const useTsx = args[0] === '--tsx'
const rest = (useTsx ? args.slice(1) : args).filter(Boolean)

function discover(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...discover(full))
    else if (/\.test\.(ts|mjs)$/.test(e.name)) out.push(full)
  }
  return out
}

let files = rest
if (rest[0] === '--dir') {
  if (!rest[1]) {
    console.error('usage: node scripts/test-fail-fast.mjs [--tsx] --dir <dir>')
    process.exit(2)
  }
  try {
    files = discover(rest[1]).sort()
  } catch (e) {
    console.error(`✖ cannot read test dir ${rest[1]}: ${e.message}`)
    process.exit(2)
  }
  if (!files.length) {
    console.error(`✖ no *.test.ts / *.test.mjs files found under ${rest[1]}`)
    process.exit(2)
  }
}

if (!files.length) {
  console.error('usage: node scripts/test-fail-fast.mjs [--tsx] (--dir <dir> | <test-file>...)')
  process.exit(2)
}

function resolveTsxBin() {
  try {
    const pkg = require.resolve('tsx/package.json', {
      paths: [
        resolve(process.cwd(), 'auth'),
        resolve(__dirname, '../auth'),
        resolve(__dirname, '..'),
        process.cwd(),
      ],
    })
    return resolve(dirname(pkg), 'dist/cli.mjs')
  } catch {
    return null
  }
}

for (const file of files) {
  const abs = resolve(file)
  console.error(`\n▸ ${file}`)

  /** @type {string[]} */
  let cmd
  if (useTsx) {
    const tsxCli = resolveTsxBin()
    if (!tsxCli) {
      console.error('✖ fail-fast: tsx not found (npm install in auth/)')
      process.exit(1)
    }
    cmd = [process.execPath, tsxCli, '--test', '--test-concurrency=1', abs]
  } else {
    cmd = [process.execPath, '--test', '--test-concurrency=1', abs]
  }

  const r = spawnSync(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    env: process.env,
  })
  const code = r.status ?? 1
  if (code !== 0) {
    console.error(
      `\n✖ fail-fast: stopping after failure in ${file} (exit ${code})`,
    )
    process.exit(code)
  }
}

console.error(`\n✔ ${files.length} test file(s) passed`)
process.exit(0)
