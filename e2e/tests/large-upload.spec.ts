import { test, expect, repoPath } from '../fixtures'
import { createWorkspace } from '../helpers/oxenApi'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(__dirname, '../fixtures')
const sampleTxt = path.join(fixtures, 'sample.txt')
const wsNote = path.join(fixtures, 'ws-note.txt')

/** oxen large-upload threshold is 4 MiB — synthesize a file over that. */
function makeChunkyTemp(): string {
  const file = path.join(os.tmpdir(), `boxen-e2e-chunky-${Date.now()}.bin`)
  const fd = fs.openSync(file, 'w')
  const chunk = Buffer.alloc(1024 * 1024, 0xab)
  for (let i = 0; i < 5; i++) fs.writeSync(fd, chunk)
  fs.closeSync(fd)
  return file
}

async function openUploadModal(
  page: import('@playwright/test').Page,
  seededRepo: { namespace: string; repo: string },
) {
  await page.goto(repoPath(seededRepo, '/tree/main?manage=upload'))
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Upload' })).toBeVisible({
    timeout: 30_000,
  })
  return dialog
}

test.describe('upload (unified size-aware flow)', () => {
  test('TC-F-13: multi-file upload via Manage Files', async ({
    page,
    seededRepo,
  }) => {
    const dialog = await openUploadModal(page, seededRepo)
    await dialog.locator('input[name="file"]').setInputFiles([sampleTxt, wsNote])
    await dialog.getByLabel('Destination directory').fill('multi')
    await dialog.getByRole('button', { name: 'Upload' }).click()

    const ok = page.locator('.manage-files-toast.ok, p.ok').first()
    await expect(ok).toContainText(/Uploaded 2 file/, { timeout: 120_000 })
    await expect(ok).toContainText('sample.txt')
    await expect(ok).toContainText('ws-note.txt')
  })

  test('L-01: chunked path used for large files', async ({
    page,
    seededRepo,
  }) => {
    const chunky = makeChunkyTemp()
    try {
      const dialog = await openUploadModal(page, seededRepo)
      await dialog.locator('input[name="file"]').setInputFiles(chunky)
      await dialog.getByLabel('Destination directory').fill('bulk')
      await dialog.getByRole('button', { name: 'Upload' }).click()

      const ok = page.locator('.manage-files-toast.ok, p.ok').first()
      await expect(ok).toContainText(/Uploaded 1 file/, { timeout: 120_000 })
      await expect(ok).toContainText(/chunked/)
      await expect(ok).toContainText(/chunks/)
    } finally {
      fs.unlinkSync(chunky)
    }
  })

  test('L-02: large upload staged into workspace', async ({
    page,
    seededRepo,
  }) => {
    const ws = await createWorkspace(
      seededRepo.namespace,
      seededRepo.repo,
      'main',
      'large-ws',
    )
    const chunky = makeChunkyTemp()
    try {
      const dialog = await openUploadModal(page, seededRepo)
      await dialog.locator('input[name="file"]').setInputFiles(chunky)
      await dialog.getByLabel('Stage into workspace').selectOption(ws.id)
      await dialog.getByRole('button', { name: 'Upload' }).click()

      await expect(
        page.locator('.manage-files-toast.ok, p.ok').first(),
      ).toContainText(/staged into workspace/i, { timeout: 120_000 })
    } finally {
      fs.unlinkSync(chunky)
    }
  })

  test('legacy /upload route opens unified Upload modal', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo, '/upload'))
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Upload' }),
    ).toBeVisible({
      timeout: 30_000,
    })
  })
})
