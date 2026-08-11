import assert from 'node:assert/strict'
import test from 'node:test'
import { getPaginationItems } from '../lib/pagination'

test('pagination keeps the first page window compact', () => {
  assert.deepEqual(getPaginationItems(1, 100), [1, 2, 3, 4, 5, 6, 7, 'ellipsis', 100])
})

test('pagination centers a middle page around seven continuous pages', () => {
  assert.deepEqual(getPaginationItems(20, 100), [1, 'ellipsis', 17, 18, 19, 20, 21, 22, 23, 'ellipsis', 100])
})

test('pagination does not duplicate the last page near the end', () => {
  assert.deepEqual(getPaginationItems(99, 100), [94, 95, 96, 97, 98, 99, 100])
})
