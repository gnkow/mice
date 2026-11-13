#!/usr/bin/env node
/**
 * Signs auth/release-manifest.json with the release Ed25519 key.
 *
 * Usage:
 *   node --import tsx scripts/sign-release-manifest.mjs
 *   RELEASE_MANIFEST_SIGNING_KEY="-----BEGIN PRIVATE KEY-----..." node --import tsx scripts/sign-release-manifest.mjs
 *
 * When RELEASE_MANIFEST_SIGNING_KEY is unset, uses the development key that matches
 * RELEASE_MANIFEST_PUBLIC_KEY_PEM in src/releaseManifest.ts (not for production).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReleaseManifestBody,
  signReleaseManifest,
} from '../src/releaseManifest.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'release-manifest.json')

const DEV_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAtAS86xnm8SBJnMUKpXp+SD9CubuqtNl7S4EsO1Hlnn
-----END PRIVATE KEY-----
`

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const body = buildReleaseManifestBody(pkg.version ?? '0.0.0')
const privatePem = process.env.RELEASE_MANIFEST_SIGNING_KEY?.trim() || DEV_PRIVATE_KEY
const signature = signReleaseManifest(body, privatePem)
const signed = { ...body, signature }
writeFileSync(outPath, `${JSON.stringify(signed, null, 2)}\n`)
console.log(`Wrote ${outPath} (release ${body.releaseVersion})`)
