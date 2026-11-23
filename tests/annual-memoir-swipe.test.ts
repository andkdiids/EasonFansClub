import assert from 'node:assert/strict'
import test from 'node:test'
import { memoirSwipeDirection } from '../lib/annual-memoir-swipe'

test('memoir turns left for next and right for previous', () => {
  assert.equal(memoirSwipeDirection(-48, 0, 150), 1)
  assert.equal(memoirSwipeDirection(85, 10, 150), -1)
})

test('memoir ignores taps, vertical or diagonal gestures, and long presses', () => {
  for (const [dx, dy, elapsed] of [[0, 0, 90], [47, 0, 90], [50, 100, 90], [60, 40, 90], [-80, 2, 500]]) {
    assert.equal(memoirSwipeDirection(dx, dy, elapsed), 0)
  }
})
