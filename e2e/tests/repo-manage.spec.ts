import type { Page } from '@playwright/test'
import { test, expect, repoPath, repoTitle } from '../fixtures'
import {
  createNamespace,
  createNamespaceAs,
  deleteRepo,
  deleteRepoAs,
  putNamespaceMemberAs,
  uniqueId,
} from '../helpers/oxenApi'
import { mintSession, mintSessionCookie } from '../helpers/session'

/** Suite identity from fixtures mintSessionCookie default. */
const SUITE_IDENTITY = { sub: 'e2e-user', iss: 'mice-e2e' } as const

/** Complete reason + optional e-sign dialogs when the env requires them. */
async function completeReasonCeremonyIfPresent(page: Page, reason: string) {
  const reasonDialog = page.getByRole('dialog', {
    name: /Reason and signature required/i,
  })
  if (!(await reasonDialog.isVisible().catch(() => false))) return
  await reasonDialog.getByLabel('Reason').fill(reason)
  await reasonDialog.getByRole('button', { name: /Review signature/i }).click()
  const signDialog = page.getByRole('dialog', { name: /Electronic signature/i })
  if (await signDialog.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await signDialog.getByRole('button', { name: /Sign and continue/i }).click()
  }
}

test.describe('repository manage (R-05 R-06 R-07–R-09)', () => {
  test('R-05: rename updates display name and keeps the stable id path', async ({
    page,
    seededRepo,
  }) => {
    const nextName = 'renamed-repo'
    await page.goto(repoPath(seededRepo, '/settings'))
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByPlaceholder('New name').fill(nextName)
    await page.getByRole('button', { name: 'Rename' }).click()

    await expect(page).toHaveURL(
      new RegExp(`/n/${seededRepo.namespace}/r/${nextName}/tree/`),
      { timeout: 30_000 },
    )
    await expect(repoTitle(page, nextName)).toBeVisible()

    // Fixture teardown still targets the original name — delete the renamed row.
    await deleteRepo(seededRepo.namespace, nextName)
  })

  test('R-06: AuthZ transfer one-shot moves repo when caller owns dest', async ({
    page,
    seededRepo,
  }) => {
    const targetNs = uniqueId('mice-e2e-xfer')
    // Same suite identity owns both namespaces → server one-shots.
    await createNamespace(targetNs)

    await page.goto(repoPath(seededRepo, '/settings'))
    await expect(page.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible({
      timeout: 20_000,
    })

    const transfer = page.locator('#repo-transfer')
    await transfer.getByLabel('Target namespace').selectOption(targetNs)
    await expect(transfer.getByLabel('Access changes')).toBeVisible({
      timeout: 15_000,
    })
    await transfer.getByRole('button', { name: 'Transfer' }).click()
    await completeReasonCeremonyIfPresent(
      page,
      'E2E R-06 AuthZ transfer one-shot to destination namespace',
    )

    await expect(page).toHaveURL(
      new RegExp(`/n/${targetNs}/r/${seededRepo.repo}/tree/`),
      { timeout: 45_000 },
    )
    await expect(repoTitle(page, seededRepo.repo)).toBeVisible()

    // Fixture teardown deletes original ns/repo — clean transferred location.
    await deleteRepo(targetNs, seededRepo.repo)
  })

  test('R-06b: AuthZ transfer stays pending when dest Owner differs; dest accepts', async ({
    page,
    seededRepo,
  }) => {
    test.setTimeout(120_000)

    const targetNs = uniqueId('mice-e2e-xfer-dst')
    const destOwner = await mintSessionCookie({
      sub: uniqueId('xfer-dst-owner'),
      name: 'E2E Dest Owner',
      email: 'xfer-dst@mice.local',
      role: 'manager',
    })
    await createNamespaceAs(destOwner, targetNs)
    // Suite must be a dest member to see the ns in the transfer picker, but not
    // Owner — otherwise the server one-shots instead of pending.
    await putNamespaceMemberAs(destOwner, targetNs, {
      ...SUITE_IDENTITY,
      role: 'member',
    })

    // Source Owner (suite) proposes into a namespace they do not own.
    await page.goto(repoPath(seededRepo, '/settings'))
    await expect(page.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible({
      timeout: 20_000,
    })

    const transfer = page.locator('#repo-transfer')
    await transfer.getByLabel('Target namespace').selectOption(targetNs)
    await expect(transfer.getByLabel('Access changes')).toBeVisible({
      timeout: 15_000,
    })
    await transfer.getByRole('button', { name: 'Transfer' }).click()
    await completeReasonCeremonyIfPresent(
      page,
      'E2E R-06b propose transfer to foreign destination namespace',
    )

    await expect(transfer.getByText(/Pending transfer to/i)).toBeVisible({
      timeout: 45_000,
    })
    await expect(transfer.locator(`code`, { hasText: targetNs })).toBeVisible()

    // Dest Owner reviews inbox and accepts.
    await mintSession(page, destOwner.identity)
    await page.goto(`/n/${encodeURIComponent(targetNs)}/settings#ns-incoming-transfers`)
    const inbox = page.locator('#ns-incoming-transfers')
    await expect(inbox.getByRole('heading', { name: 'Incoming transfers' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      inbox.getByRole('link', {
        name: `${seededRepo.namespace}/${seededRepo.repo}`,
      }),
    ).toBeVisible({ timeout: 15_000 })

    await inbox.getByRole('button', { name: /Review & accept/i }).click()
    await expect(inbox.getByLabel('Access changes')).toBeVisible({ timeout: 15_000 })
    await inbox.getByRole('checkbox', { name: /I understand the access changes/i }).check()
    await inbox.getByRole('button', { name: /Accept transfer/i }).click()
    await completeReasonCeremonyIfPresent(
      page,
      'E2E R-06b dest Owner accept pending repository transfer',
    )

    await expect(page).toHaveURL(
      new RegExp(`/n/${targetNs}/r/${seededRepo.repo}/tree/`),
      { timeout: 45_000 },
    )
    await expect(repoTitle(page, seededRepo.repo)).toBeVisible()

    await deleteRepoAs(destOwner, targetNs, seededRepo.repo)
  })

  test('R-07 R-08 R-09: size and stats on overview', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo))
    const about = page.locator('aside.repo-aside')
    await expect(about.getByText(/\bsize\b/i)).toBeVisible({ timeout: 15_000 })
    await about
      .getByRole('button', { name: 'Refresh size and metadata' })
      .click()
    await expect(about.locator('.flash-error')).toHaveCount(0)
    await expect(about.getByText(/\bsize\b/i)).toBeVisible()
  })
})
