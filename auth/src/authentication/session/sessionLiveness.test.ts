import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideSessionLiveness } from './sessionLiveness.js'

describe('decideSessionLiveness', () => {
  const base = {
    sessionStart: 1_000,
    lastActive: 1_000,
    ttlSec: 8 * 3600,
    idleSec: 15 * 60,
  }

  it('keeps a Session alive inside idle and absolute windows', () => {
    assert.deepEqual(
      decideSessionLiveness({ ...base, now: 1_000 + 60 }),
      { alive: true },
    )
  })

  it('expires when absolute lifetime elapses', () => {
    assert.deepEqual(
      decideSessionLiveness({ ...base, now: 1_000 + base.ttlSec }),
      { alive: false, reason: 'absolute' },
    )
  })

  it('expires when idle timeout elapses', () => {
    assert.deepEqual(
      decideSessionLiveness({
        ...base,
        lastActive: 1_000,
        now: 1_000 + base.idleSec + 1,
      }),
      { alive: false, reason: 'idle' },
    )
  })

  it('ignores idle when idleSec is disabled', () => {
    assert.deepEqual(
      decideSessionLiveness({
        ...base,
        idleSec: 0,
        lastActive: 1_000,
        now: 1_000 + 24 * 3600,
        ttlSec: 48 * 3600,
      }),
      { alive: true },
    )
  })
})
