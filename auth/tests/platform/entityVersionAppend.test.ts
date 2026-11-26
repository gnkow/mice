import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendVersionInterval } from '../../src/packages/platform/index.js'

describe('appendVersionInterval', () => {
  it('runs closeOpen before openNext with the same at', async () => {
    const order: string[] = []
    const stamps: Date[] = []
    const at = new Date('2026-11-16T12:00:00.000Z')
    await appendVersionInterval({
      at,
      closeOpen: async (when) => {
        order.push('close')
        stamps.push(when)
      },
      openNext: async (when) => {
        order.push('open')
        stamps.push(when)
      },
    })
    assert.deepEqual(order, ['close', 'open'])
    assert.equal(stamps[0], at)
    assert.equal(stamps[1], at)
  })
})
