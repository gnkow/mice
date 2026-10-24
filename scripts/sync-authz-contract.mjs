#!/usr/bin/env node
/**
 * Refresh the web and CLI copies of the authz contract from auth/src/authzContract.ts.
 * Docker build contexts are per package, so web and CLI cannot import across packages;
 * auth/src/authzContract.test.ts fails when a copy is stale.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'auth', 'package.json'))
const ts = require('typescript')

const src = join(root, 'auth/src/authzContract.ts')
copyFileSync(src, join(root, 'web/src/lib/authzContract.ts'))

const js = ts.transpileModule(readFileSync(src, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: false },
}).outputText
writeFileSync(
  join(root, 'cli/lib/authzContract.mjs'),
  `// GENERATED from auth/src/authzContract.ts by scripts/sync-authz-contract.mjs. Do not edit.\n${js}`,
)
