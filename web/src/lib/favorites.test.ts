import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortWithFavorites } from './favorites'

test('pins favorites and keeps relative order', () => {
  assert.deepEqual(sortWithFavorites(['a', 'b', 'c', 'd'], (x) => x === 'c' || x === 'b'), ['b', 'c', 'a', 'd'])
})

test('applies base order within groups', () => {
  assert.deepEqual(
    sortWithFavorites(['z', 'a', 'y', 'b'], (x) => x === 'z' || x === 'y', (a, b) => a.localeCompare(b)),
    ['y', 'z', 'a', 'b'],
  )
})
