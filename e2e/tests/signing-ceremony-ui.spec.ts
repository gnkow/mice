import { expect } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'
import { expectSigningChallenge } from '../helpers/signingCeremony'

const MR_ID = 'mr-e2e-92'
const NS = 'demo'
const REPO = 'sample'
const HASH = 'a'.repeat(64)

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    mergeRequest: {
      id: MR_ID,
      repositoryId: 'repo-1',
      namespace: NS,
      repo: REPO,
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 's'.repeat(40),
      expectedTargetHead: 't'.repeat(40),
      status: 'open',
      openedBy: 'mice-e2e|other-opener',
      title: 'GxP #92 ceremony',
      description: '',
      mergeCommitId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    meaning: 'Approved',
    content: '',
    hash: HASH,
    binding: {
      repo: `${NS}/${REPO}`,
      sourceHead: 's'.repeat(40),
      targetHead: 't'.repeat(40),
      manifestDigest: HASH,
    },
    manifest: '',
    manifestEntries: [],
    validatedTarget: true,
    principal: {
      iss: 'mice-e2e',
      sub: 'approver',
      name: 'Approver Example',
    },
    ...overrides,
  }
}

async function stubMrPage(
  page: import('@playwright/test').Page,
  overrides: Record<string, unknown> = {},
) {
  await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(previewBody(overrides)),
    })
  })
  await page.route(`**/auth/merge-requests/${MR_ID}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mergeRequest: previewBody().mergeRequest }),
    })
  })
  await page.route(
    `**/auth/namespaces/${NS}/repos/${REPO}/permissions**`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          permissions: {
            rename: false,
            transfer: false,
            manageCollaborators: false,
            manageApprovers: false,
            editMetadata: false,
            deleteRepository: false,
            viewSignedRecord: true,
            contentsWrite: true,
            isApprover: true,
          },
        }),
      })
    },
  )
  await page.route(`**/api/repos/${NS}/${REPO}/compare/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        compare: {
          commits: [],
          entries: [],
          counts: { added: 0, removed: 0, modified: 0 },
        },
      }),
    })
  })
  await page.route('**/auth/commit-qc**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ statuses: {} }),
    })
  })
}

async function openApproveCeremony(page: import('@playwright/test').Page) {
  await page.goto(`/n/${NS}/r/${REPO}/merge-requests/${MR_ID}`)
  await page.getByRole('button', { name: /^Approve$/ }).click()
  // Title flips to "Electronic signature" after Review — match either.
  const dialog = page.getByRole('dialog', {
    name: /Sign merge request|Electronic signature/i,
  })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('06 signing ceremony UI (#92)', () => {
  test('TC-GXP-92-01: Approve shows hash, meaning, printed name; collects reason and change-control', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })
    await stubMrPage(page)

    const dialog = await openApproveCeremony(page)

    await expect(dialog.getByText('Approved', { exact: true }).first()).toBeVisible()
    await expect(dialog.getByText('Approver Example').first()).toBeVisible()
    await expect(dialog.getByTestId('merge-sign-content-hash')).toContainText(HASH)
    await expect(dialog.getByLabel('Change-control id')).toBeVisible()

    await dialog.getByLabel('Reason').fill('Approve assay feature into main for release')
    await dialog.getByRole('button', { name: /Review signature/i }).click()
    await expect(dialog.getByRole('heading', { name: /Electronic signature/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Sign and complete merge/i })).toBeVisible()
  })

  test('TC-GXP-92-02: content change after display invalidates pending signature', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92b'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })

    let afterExecute = false
    await stubMrPage(page)
    await page.unroute(`**/auth/merge-requests/${MR_ID}/signing-preview**`)
    await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
      const hash = afterExecute ? 'b'.repeat(64) : HASH
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          previewBody({
            hash,
            binding: {
              repo: `${NS}/${REPO}`,
              sourceHead: 's'.repeat(40),
              targetHead: 't'.repeat(40),
              manifestDigest: hash,
            },
          }),
        ),
      })
    })

    await page.route('**/auth/sign/execute', async (route) => {
      afterExecute = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          signature: { id: 'sig-1', changeControlId: 'CC-1', hash: HASH },
        }),
      })
    })
    await page.route(`**/auth/merge-requests/${MR_ID}/complete`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'complete should not run when hash drifted' }),
      })
    })

    const dialog = await openApproveCeremony(page)
    await dialog.getByLabel('Reason').fill('Approve assay feature into main for release')
    await dialog.getByRole('button', { name: /Review signature/i }).click()
    await dialog.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expect(dialog.getByRole('alert')).toContainText(/Content changed after display/i)
  })

  test('TC-GXP-92-03: clear refusal for not approver', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92c'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })
    await stubMrPage(page)
    await page.route('**/auth/sign/execute', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          signature: { id: 'sig-1', changeControlId: 'CC-1', hash: HASH },
        }),
      })
    })
    await page.route(`**/auth/merge-requests/${MR_ID}/complete`, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Approver role required',
          code: 'not_approver',
        }),
      })
    })

    const dialog = await openApproveCeremony(page)
    await dialog.getByLabel('Reason').fill('Approve assay feature into main for release')
    await dialog.getByRole('button', { name: /Review signature/i }).click()
    await dialog.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expect(dialog.getByTestId('merge-sign-error')).toContainText(/Approver role/i)
  })

  test('TC-GXP-92-04: step-up challenge shows interstitial before redirect', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92d'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })
    await stubMrPage(page)
    await page.route('**/auth/sign/execute', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reauthentication_required',
          maxAge: 60,
          reauthUrl: `/auth/reauth?max_age=60&next=%2Fn%2F${NS}%2Fr%2F${REPO}%2Fmerge-requests%2F${MR_ID}`,
        }),
      })
    })

    const dialog = await openApproveCeremony(page)
    await dialog.getByLabel('Reason').fill('Approve assay feature into main for release')
    await dialog.getByRole('button', { name: /Review signature/i }).click()
    await dialog.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expectSigningChallenge(page, /Confirm it's you/i, 'step_up', /fresh sign-in/i)
  })

  test('TC-GXP-92-05: audit unavailable refusal is announced', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92e'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })
    await stubMrPage(page)
    await page.route('**/auth/sign/execute', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          signature: { id: 'sig-1', changeControlId: 'CC-1', hash: HASH },
        }),
      })
    })
    await page.route(`**/auth/merge-requests/${MR_ID}/complete`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Audit store unavailable',
          code: 'audit_unavailable',
        }),
      })
    })

    const dialog = await openApproveCeremony(page)
    await dialog.getByLabel('Reason').fill('Approve assay feature into main for release')
    await dialog.getByRole('button', { name: /Review signature/i }).click()
    await dialog.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expect(dialog.getByTestId('merge-sign-error')).toContainText(/Audit is unavailable/i)
  })
})
