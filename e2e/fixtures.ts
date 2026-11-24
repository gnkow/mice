import { test as base, expect, type Page } from '@playwright/test'
import {
  clearSuiteSessionCache,
  createRepo,
  deleteRepo,
  plantSuiteSession,
  putFile,
  uniqueId,
  waitForOxen,
} from './helpers/oxenApi'
import { cleanupContext, cleanupSince, revokeTokensSince, snapshot, trackSessionCookies } from './helpers/cleanup'
import { mintSessionCookie, type MintedSession } from './helpers/session'

export type RepoFixture = {
  namespace: string
  repo: string
  seeded: boolean
}

type Fixtures = {
  emptyRepo: RepoFixture
  seededRepo: RepoFixture
}

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
/** Default suite principal from mintSession / mintSessionCookie. */
const SUITE_IDENTITY = { sub: 'e2e-user', iss: 'mice-e2e' } as const

/** Prefer the Playwright page cookie; fall back to a single cached suite mint. */
let fixtureSession: MintedSession | null = null

async function fixtureCookieHeader(): Promise<string> {
  if (!fixtureSession) fixtureSession = await mintSessionCookie()
  return `${fixtureSession.cookieName}=${fixtureSession.cookieValue}`
}

/** Oxen create alone is invisible under RBAC; claim AuthZ ownership for the suite identity. */
async function claimNamespace(namespace: string): Promise<void> {
  const cookie = await fixtureCookieHeader()
  const res = await fetch(`${BASE_URL}/auth/namespaces`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: BASE_URL,
      'x-mice-reason': 'e2e: claim seeded namespace',
    },
    body: JSON.stringify({
      name: namespace,
      basePermission: 'none',
      membersCanCreateRepos: true,
    }),
  })
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => '')
    throw new Error(`claimNamespace failed ${res.status}: ${text}`)
  }
}

/**
 * Namespace Owner does not imply repo data access — seat the suite identity as
 * admin collaborator so History / Branches / file APIs work under RBAC.
 */
async function grantSuiteRepoAccess(namespace: string, repo: string): Promise<void> {
  const cookie = await fixtureCookieHeader()
  const path = `/auth/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}/collaborators`
  const body = {
    kind: 'user' as const,
    sub: SUITE_IDENTITY.sub,
    iss: SUITE_IDENTITY.iss,
    role: 'admin' as const,
  }
  const reason = 'e2e: seat suite identity as admin collaborator for data access'
  const sigRes = await fetch(`${AUTH_URL}/auth/dev/mutation-signature`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: BASE_URL,
      'x-mice-reason': reason,
    },
    body: JSON.stringify({ method: 'PUT', path, reason, body }),
  })
  if (!sigRes.ok) {
    throw new Error(`mutation-signature failed ${sigRes.status}: ${await sigRes.text()}`)
  }
  const { signatureId } = (await sigRes.json()) as { signatureId: string }
  const put = await fetch(`${AUTH_URL}${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: BASE_URL,
      'x-mice-reason': reason,
      'x-mice-signature-id': signatureId,
    },
    body: JSON.stringify(body),
  })
  if (!put.ok) {
    throw new Error(`grantSuiteRepoAccess failed ${put.status}: ${await put.text()}`)
  }
}

async function makeRepo(seeded: boolean): Promise<RepoFixture> {
  const namespace = uniqueId('mice-e2e')
  const repo = 'repo'
  await claimNamespace(namespace)
  await createRepo(namespace, repo)
  await grantSuiteRepoAccess(namespace, repo)
  if (seeded) {
    // main is write-protected via BFF; putFile falls back to physical oxen keys.
    await putFile(
      namespace,
      repo,
      'main',
      'readme.txt',
      'hello from e2e\n',
      'seed readme',
    )
  }
  return { namespace, repo, seeded }
}

/**
 * Every test removes the namespaces, instance admins and default-user tokens it
 * added, even when it fails. Suite runs serially, so a before/after diff is safe.
 */
export const cleanTest = base.extend<{ bffCleanup: void }>({
  bffCleanup: [
    async ({ context }, use) => {
      const sessionCookies = trackSessionCookies(context)
      const startedAt = Date.now() - 1000
      const ctx = await cleanupContext()
      const before = await snapshot(ctx)
      await use()
      await revokeTokensSince(sessionCookies(), startedAt).catch(() => undefined)
      await cleanupSince(ctx, before)
      await ctx.dispose()
    },
    { auto: true },
  ],
})

/** Establish a BFF session before UI tests hit /api. */
export const test = cleanTest.extend<Fixtures>({
  page: async ({ page }, use) => {
    clearSuiteSessionCache()
    fixtureSession = await mintSessionCookie()
    plantSuiteSession(fixtureSession)
    const url = new URL(BASE_URL)
    const hostPrefixed = fixtureSession.cookieName.startsWith('__Host-')
    await page.context().addCookies([
      hostPrefixed
        ? {
            name: fixtureSession.cookieName,
            value: fixtureSession.cookieValue,
            url: BASE_URL,
            httpOnly: true,
            sameSite: 'Lax' as const,
            secure: true,
          }
        : {
            name: fixtureSession.cookieName,
            value: fixtureSession.cookieValue,
            domain: url.hostname,
            path: '/',
            httpOnly: true,
            sameSite: 'Lax' as const,
            secure: false,
          },
    ])
    await use(page)
    fixtureSession = null
    clearSuiteSessionCache()
  },
  emptyRepo: async ({}, use) => {
    await waitForOxen()
    const ctx = await makeRepo(false)
    await use(ctx)
    await deleteRepo(ctx.namespace, ctx.repo).catch(() => undefined)
  },
  seededRepo: async ({}, use) => {
    await waitForOxen()
    const ctx = await makeRepo(true)
    await use(ctx)
    await deleteRepo(ctx.namespace, ctx.repo).catch(() => undefined)
  },
})

export { expect }

export function repoPath(ctx: RepoFixture, suffix = '') {
  const base = `/n/${encodeURIComponent(ctx.namespace)}/r/${encodeURIComponent(ctx.repo)}`
  return suffix ? `${base}${suffix}` : base
}

/** Complete the in-app confirm modal (optionally with typed word). */
export async function acceptConfirmModal(page: Page, confirmWord?: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  if (confirmWord !== undefined) {
    await dialog.locator('input').fill(confirmWord)
  }
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })
}

export async function openAccountMenu(page: Page) {
  await page.locator('details.profile-menu > summary').click()
}

export async function openSettings(page: Page) {
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
}

/** Repo title in the title bar (avoids breadcrumb h1 strict-mode clashes). */
export function repoTitle(page: Page, name: string) {
  return page.locator('h2.repo-title-name', { hasText: name })
}

/** File name link in the tree list (avoids latest-commit message link clashes). */
export function fileNameLink(page: Page, name: string | RegExp) {
  return page.locator('a.file-name-link', { hasText: name })
}

/** Open a file-row ⋯ menu action (Delete / Move / …). */
export async function fileRowAction(
  page: Page,
  entryName: string | RegExp,
  action: string | RegExp,
) {
  const row = page.locator('.file-row', {
    has: page.locator('a.file-name-link', { hasText: entryName }),
  })
  await row.hover()
  await row.locator('summary[aria-label^="More actions"]').click({ force: true })
  await row.locator('.row-more-menu').getByRole('button', { name: action }).click()
}
