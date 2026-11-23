import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import {
  KEYCLOAK_MANAGER,
  KEYCLOAK_REGULAR_USER,
  KEYCLOAK_REGULAR_USER_2,
  signInWithKeycloakUser,
  signOutViaUi,
} from '../helpers/keycloak'
import { uniqueId } from '../helpers/oxenApi'
import { regulatedMutationHeaders } from '../helpers/regulated'
import { mintSession } from '../helpers/session'
import { completeLiveKeycloakStepUp } from '../helpers/signingCeremony'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const NS = 'demo'
const REPO = 'sample'

type MeUser = { sub: string; iss: string; email?: string; name?: string }

async function readMe(page: Page): Promise<MeUser> {
  const res = await page.request.get(`${AUTH_URL}/auth/me`)
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = (await res.json()) as { authenticated?: boolean; user?: MeUser }
  expect(body.authenticated).toBe(true)
  expect(body.user?.sub).toBeTruthy()
  expect(body.user?.iss).toBeTruthy()
  return body.user!
}

async function ensureRestoreTestPassed(page: Page) {
  await mintSession(page, {
    role: 'admin',
    mfa: true,
    sub: uniqueId('restore-admin'),
    iss: 'mice-e2e',
  })
  const path = '/auth/admin/restore-test/pass'
  const headers = await regulatedMutationHeaders(page.request, {
    method: 'POST',
    path,
    body: {},
    reason: 'E2E: unlock restore-test gate before signed merge',
  })
  const res = await page.request.post(`${AUTH_URL}${path}`, {
    headers,
    data: {},
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  await page.context().clearCookies()
}

async function skipIfOidcUnreachable(page: Page) {
  if (page.url().includes('status=unreachable')) {
    test.skip(
      true,
      'OIDC callback could not establish a session (IdP directory/unreachable)',
    )
  }
}

async function createFeatureBranchWithCommit(
  page: Page,
  branch: string,
): Promise<{ sourceHead: string; targetHead: string }> {
  const reason = 'E2E: open source branch for signed merge approver coverage'
  const create = await page.request.post(
    `${BASE_URL}/api/repos/${encodeURIComponent(NS)}/${encodeURIComponent(REPO)}/branches`,
    {
      headers: {
        'content-type': 'application/json',
        'x-mice-reason': reason,
      },
      data: { new_name: branch, from_name: 'main' },
    },
  )
  expect(create.ok(), await create.text()).toBeTruthy()

  // Unique path per branch so repeated runs do not conflict on main.
  const fileName = `${branch}.txt`
  const put = await page.request.fetch(
    `${BASE_URL}/api/repos/${encodeURIComponent(NS)}/${encodeURIComponent(REPO)}/file/${encodeURIComponent(branch)}/${encodeURIComponent(fileName)}`,
    {
      method: 'PUT',
      headers: { 'x-mice-reason': reason },
      multipart: {
        file: {
          name: fileName,
          mimeType: 'text/plain',
          buffer: Buffer.from(`approve coverage ${branch}\n`),
        },
        message: `E2E commit on ${branch}`,
        name: 'Regular User',
        email: 'mice_user@mice.com',
      },
    },
  )
  expect(put.ok(), await put.text()).toBeTruthy()

  const branches = await page.request.get(
    `${BASE_URL}/api/repos/${encodeURIComponent(NS)}/${encodeURIComponent(REPO)}/branches`,
  )
  expect(branches.ok(), await branches.text()).toBeTruthy()
  const body = (await branches.json()) as {
    branches?: Array<{ name: string; commit_id?: string; commit?: { id?: string } }>
  }
  const list = body.branches ?? []
  const tip = (name: string) => {
    const b = list.find((x) => x.name === name)
    const id = b?.commit_id ?? b?.commit?.id
    expect(id, `${name} tip`).toBeTruthy()
    return id!
  }
  return { sourceHead: tip(branch), targetHead: tip('main') }
}

async function openMergeRequest(
  page: Page,
  input: {
    sourceBranch: string
    sourceHead: string
    targetHead: string
    title: string
  },
): Promise<{ id: string }> {
  const path = `/auth/repos/${encodeURIComponent(NS)}/${encodeURIComponent(REPO)}/merge-requests`
  const body = {
    sourceBranch: input.sourceBranch,
    targetBranch: 'main',
    expectedSourceHead: input.sourceHead,
    expectedTargetHead: input.targetHead,
    title: input.title,
    description: 'E2E signed-merge approver coverage',
  }
  const headers = await regulatedMutationHeaders(page.request, {
    method: 'POST',
    path,
    body,
    reason: 'E2E: open merge request into validated main',
  })
  const res = await page.request.post(`${AUTH_URL}${path}`, { headers, data: body })
  expect(res.ok(), await res.text()).toBeTruthy()
  const json = (await res.json()) as { mergeRequest: { id: string } }
  return json.mergeRequest
}

async function grantRepoApprover(
  page: Page,
  target: { sub: string; iss: string },
) {
  const path = `/auth/namespaces/${encodeURIComponent(NS)}/repos/${encodeURIComponent(REPO)}/approvers`
  const body = { kind: 'user', sub: target.sub, iss: target.iss }
  const headers = await regulatedMutationHeaders(page.request, {
    method: 'PUT',
    path,
    body,
    reason: 'E2E: assign Regular User Two as demo/sample approver',
  })
  const res = await page.request.fetch(`${AUTH_URL}${path}`, {
    method: 'PUT',
    headers,
    data: body,
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function ceremonyOutcome(
  page: Page,
  form: ReturnType<Page['locator']>,
): Promise<'success' | 'interstitial' | 'alert' | 'review' | 'reason' | 'busy' | 'other'> {
  if (
    await form
      .getByRole('status')
      .filter({ hasText: /Signed merge completed/i })
      .isVisible()
      .catch(() => false)
  ) {
    return 'success'
  }
  if (await page.getByTestId('signing-challenge-interstitial').isVisible().catch(() => false)) {
    return 'interstitial'
  }
  if (await form.getByRole('alert').isVisible().catch(() => false)) return 'alert'
  if (await form.getByRole('button', { name: /Signing/i }).isVisible().catch(() => false)) {
    return 'busy'
  }
  if (await form.getByRole('heading', { name: /Electronic signature/i }).isVisible().catch(() => false)) {
    return 'review'
  }
  if (await form.getByLabel('Reason').isVisible().catch(() => false)) return 'reason'
  return 'other'
}

/**
 * Drive MergeRequestSignPanel: reason → review Sign → step-up if challenged → success.
 */
async function approveMergeViaCeremony(
  page: Page,
  account: { user: string; password: string; totpSecret?: string },
  reason: string,
  form: ReturnType<Page['locator']>,
) {
  const baseURL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
  const ctx = page.context()
  // Clear suite-wide reason so the signed content matches retry headers.
  await ctx.setExtraHTTPHeaders({ origin: baseURL })

  try {
    await expect(form).toBeVisible({ timeout: 20_000 })
    await form.getByLabel('Reason').fill(reason)
    await form.getByRole('button', { name: /^Sign$/ }).click()
    await expect(form.getByRole('heading', { name: /Electronic signature/i })).toBeVisible({
      timeout: 15_000,
    })

    for (let i = 0; i < 10; i++) {
      let outcome = await ceremonyOutcome(page, form)
      if (outcome === 'success') return
      if (outcome === 'alert') {
        const msg = (await form.getByRole('alert').innerText()).trim()
        throw new Error(`Merge sign refused: ${msg}`)
      }
      if (outcome === 'interstitial') {
        await completeLiveKeycloakStepUp(page, account)
        await expect(form).toBeVisible({ timeout: 20_000 })
        continue
      }
      if (outcome === 'reason') {
        await form.getByLabel('Reason').fill(reason)
        await form.getByRole('button', { name: /^Sign$/ }).click()
        await expect(form.getByRole('heading', { name: /Electronic signature/i })).toBeVisible({
          timeout: 15_000,
        })
        continue
      }
      if (outcome === 'review') {
        await form.getByRole('button', { name: /^Sign$/ }).click()
      }
      // Wait out Signing… / network (manifest + MFA challenge).
      // Success may unmount the panel immediately via onComplete — treat that as done.
      await expect
        .poll(
          async () => {
            if (!(await form.isVisible().catch(() => false))) return 'gone'
            return ceremonyOutcome(page, form)
          },
          { timeout: 60_000 },
        )
        .not.toBe('busy')
      if (!(await form.isVisible().catch(() => false))) return
      outcome = await ceremonyOutcome(page, form)
      if (outcome === 'success') return
      if (outcome === 'alert') {
        const msg = (await form.getByRole('alert').innerText()).trim()
        throw new Error(`Merge sign refused: ${msg}`)
      }
    }

    if (await form.isVisible().catch(() => false)) {
      await expect(
        form.getByRole('status').filter({ hasText: /Signed merge completed/i }),
      ).toBeVisible({ timeout: 5_000 })
    }
  } finally {
    await ctx.setExtraHTTPHeaders({
      'x-mice-reason': 'e2e: automated test change',
      origin: baseURL,
    })
  }
}

test.describe('Signed merge with repo approver (live Keycloak)', () => {
  test('TC-GXP-MR-APPROVE-01: manager assigns user_2; user_1 opens MR; user_2 signs', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    await ensureRestoreTestPassed(page)

    // Capture Regular User Two's IdP principal for the approver seat.
    try {
      await signInWithKeycloakUser(page, KEYCLOAK_REGULAR_USER_2)
    } catch (err) {
      await skipIfOidcUnreachable(page)
      throw err
    }
    await skipIfOidcUnreachable(page)
    const approver = await readMe(page)
    await signOutViaUi(page)

    // Manager (demo owner) assigns user_2 as repo approver on sample.
    await signInWithKeycloakUser(page, KEYCLOAK_MANAGER)
    await skipIfOidcUnreachable(page)
    await grantRepoApprover(page, { sub: approver.sub, iss: approver.iss })
    await signOutViaUi(page)

    // Regular User opens a unique source branch → MR into validated main.
    await signInWithKeycloakUser(page, KEYCLOAK_REGULAR_USER)
    await skipIfOidcUnreachable(page)
    const branch = uniqueId('e2e-approve')
    const heads = await createFeatureBranchWithCommit(page, branch)
    const mr = await openMergeRequest(page, {
      sourceBranch: branch,
      sourceHead: heads.sourceHead,
      targetHead: heads.targetHead,
      title: `E2E approve ${branch}`,
    })
    await signOutViaUi(page)

    // Approver signs the merge request.
    await signInWithKeycloakUser(page, KEYCLOAK_REGULAR_USER_2)
    await skipIfOidcUnreachable(page)
    await page.goto(`/n/${NS}/r/${REPO}/merge-requests/${encodeURIComponent(mr.id)}`)
    await page.getByRole('button', { name: /^Sign$/ }).click()
    await approveMergeViaCeremony(
      page,
      KEYCLOAK_REGULAR_USER_2,
      'E2E: approve merge of feature into validated main as repo approver.',
      page.locator('form.modal.reason-prompt'),
    )

    // Panel unmounts on success — confirm the MR is merged via the BFF.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${AUTH_URL}/auth/merge-requests/${encodeURIComponent(mr.id)}`,
          )
          if (!res.ok()) return `http:${res.status()}`
          const body = (await res.json()) as {
            mergeRequest?: { status?: string; mergeCommitId?: string }
          }
          return body.mergeRequest?.status ?? 'missing'
        },
        { timeout: 30_000 },
      )
      .toBe('merged')
  })
})
