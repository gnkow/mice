import { expect } from '../fixtures'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'
import { expectSigningChallenge } from '../helpers/signingCeremony'

const MR_ID = 'mr-e2e-92'
const HASH = 'a'.repeat(64)

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    mergeRequest: {
      id: MR_ID,
      repositoryId: 'repo-1',
      namespace: 'demo',
      repo: 'assay',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'src-head',
      expectedTargetHead: 'tgt-head',
      status: 'open',
      openedBy: 'mice-e2e|approver',
      mergeCommitId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    meaning: 'Approved',
    content: '',
    hash: HASH,
    binding: {
      repo: 'demo/assay',
      sourceHead: 'src-head',
      targetHead: 'tgt-head',
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

test.describe('06 signing ceremony UI (#92)', () => {
  test('TC-GXP-92-01: merge-request page shows hash, meaning, printed name and collects reason', async ({
    page,
  }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })

    await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(previewBody()),
      })
    })

    await page.goto(`/n/demo/r/assay/merge-requests/${MR_ID}`)

    await expect(page.getByRole('heading', { name: /Sign merge request/i })).toBeVisible()
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Approver Example')).toBeVisible()
    await expect(page.getByText(HASH)).toBeVisible()

    await page.getByLabel('Reason').fill('Approve assay feature into main for release')
    await page.getByRole('button', { name: /Review signature/i }).click()
    await expect(page.getByRole('button', { name: /Sign and complete merge/i })).toBeVisible()
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

    // Stay on HASH until after Review; flip only after execute so Strict Mode
    // double-mount does not advance the preview early.
    let afterExecute = false
    await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
      const hash = afterExecute ? 'b'.repeat(64) : HASH
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          previewBody({
            hash,
            binding: {
              repo: 'demo/assay',
              sourceHead: 'src-head',
              targetHead: 'tgt-head',
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

    await page.goto(`/n/demo/r/assay/merge-requests/${MR_ID}`)
    await page.getByLabel('Reason').fill('Approve assay feature into main for release')
    await page.getByRole('button', { name: /Review signature/i }).click()
    await page.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expect(page.getByRole('alert')).toContainText(/Content changed after display/i)
  })

  test('TC-GXP-92-03: clear refusal for not approver', async ({ page }) => {
    await mintSession(page, {
      sub: uniqueId('gxp92c'),
      role: 'manager',
      mfa: true,
      iss: 'mice-e2e',
      name: 'Approver Example',
    })

    await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(previewBody()),
      })
    })
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

    await page.goto(`/n/demo/r/assay/merge-requests/${MR_ID}`)
    await page.getByLabel('Reason').fill('Approve assay feature into main for release')
    await page.getByRole('button', { name: /Review signature/i }).click()
    await page.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expect(page.getByRole('alert')).toContainText(/Approver role/i)
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

    await page.route(`**/auth/merge-requests/${MR_ID}/signing-preview**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(previewBody()),
      })
    })
    await page.route('**/auth/sign/execute', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'reauthentication_required',
          maxAge: 60,
          reauthUrl: '/auth/reauth?max_age=60&next=%2Fn%2Fdemo%2Fr%2Fassay%2Fmerge-requests%2Fmr-e2e-92',
        }),
      })
    })

    await page.goto(`/n/demo/r/assay/merge-requests/${MR_ID}`)
    await page.getByLabel('Reason').fill('Approve assay feature into main for release')
    await page.getByRole('button', { name: /Review signature/i }).click()
    await page.getByRole('button', { name: /Sign and complete merge/i }).click()

    await expectSigningChallenge(page, /Confirm it's you/i, 'step_up', /fresh sign-in/i)
  })
})
