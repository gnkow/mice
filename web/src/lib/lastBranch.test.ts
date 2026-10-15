import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'

const store = new Map<string, string>()

// Minimal localStorage for node:test (browser-only API in lastBranch.ts).
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem(key: string) {
    return store.has(key) ? store.get(key)! : null
  },
  setItem(key: string, value: string) {
    store.set(key, String(value))
  },
  removeItem(key: string) {
    store.delete(key)
  },
  clear() {
    store.clear()
  },
  key() {
    return null
  },
  get length() {
    return store.size
  },
}

const {
  lastBranch,
  pickOtherBranch,
  rememberBranch,
  resolveDefaultBranch,
  getStoredDefaultBranch,
  setStoredDefaultBranch,
} = await import('./lastBranch.ts')

describe('lastBranch helpers', () => {
  beforeEach(() => {
    store.clear()
  })

  it('rememberBranch stores branch; ignores commit ids', () => {
    rememberBranch('ns', 'r', 'feature')
    assert.equal(lastBranch('ns', 'r'), 'feature')

    rememberBranch('ns', 'r', '0123456789abcdef0123456789abcdef')
    assert.equal(lastBranch('ns', 'r'), 'feature')

    rememberBranch('', 'r', 'main')
    assert.equal(lastBranch('ns', 'r'), 'feature')
  })

  it('lastBranch falls back when unset', () => {
    assert.equal(lastBranch('ns', 'missing'), 'main')
    assert.equal(lastBranch('ns', 'missing', 'develop'), 'develop')
  })

  it('pickOtherBranch prefers non-base', () => {
    assert.equal(pickOtherBranch(['main', 'feature'], 'main'), 'feature')
    assert.equal(pickOtherBranch(['main'], 'main'), null)
  })

  it('resolveDefaultBranch: stored override, then preferred, then first', () => {
    assert.equal(resolveDefaultBranch(['dev', 'main'], 'ns', 'r'), 'main')
    assert.equal(resolveDefaultBranch(['dev', 'staging'], 'ns', 'r'), 'dev')

    setStoredDefaultBranch('ns', 'r', 'staging')
    assert.equal(getStoredDefaultBranch('ns', 'r'), 'staging')
    assert.equal(
      resolveDefaultBranch(['main', 'staging', 'dev'], 'ns', 'r'),
      'staging',
    )
    // Stale stored branch ignored
    setStoredDefaultBranch('ns', 'r', 'gone')
    assert.equal(resolveDefaultBranch(['main', 'dev'], 'ns', 'r'), 'main')
  })
})
