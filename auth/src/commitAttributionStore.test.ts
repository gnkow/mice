import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  recordCommitAttribution,
  rewriteCommitAuthorsInOxenJson,
} from './commitAttributionStore.js'

describe('rewriteCommitAuthorsInOxenJson', () => {
  it('rewrites only commits with a BFF attribution row', async () => {
    await recordCommitAttribution('tip-1', {
      author: 'https://idp.example|manager',
      email: 'manager@mice.com',
      name: 'Manager',
      message: 'Initialized empty repo',
    })
    const out = await rewriteCommitAuthorsInOxenJson(
      JSON.stringify({
        commit: {
          id: 'tip-1',
          author: 'Oxen',
          email: 'oxen@oxen.ai',
          message: 'Initialized Repo 🐂',
        },
      }),
    )
    const body = JSON.parse(out) as {
      commit: { author: string; email: string; message: string }
    }
    assert.equal(body.commit.author, 'https://idp.example|manager')
    assert.equal(body.commit.email, 'manager@mice.com')
    assert.equal(body.commit.message, 'Initialized empty repo')
  })

  it('defaults empty-tip message when attribution omits one', async () => {
    await recordCommitAttribution('tip-default-msg', {
      author: 'https://idp.example|manager',
      email: 'manager@mice.com',
    })
    const out = await rewriteCommitAuthorsInOxenJson(
      JSON.stringify({
        commit: {
          id: 'tip-default-msg',
          author: 'Oxen',
          email: 'oxen@oxen.ai',
          message: 'Initialized Repo 🐂',
        },
      }),
    )
    const body = JSON.parse(out) as { commit: { message: string } }
    assert.equal(body.commit.message, 'Initialized Repo')
  })

  it('leaves unattributed commits unchanged', async () => {
    const raw = JSON.stringify({
      commit: {
        id: 'unknown-tip',
        author: 'Oxen',
        email: 'oxen@oxen.ai',
        message: 'Initialized Repo 🐂',
      },
    })
    assert.equal(await rewriteCommitAuthorsInOxenJson(raw), raw)
  })
})
