import assert from 'node:assert/strict'
import test from 'node:test'
import { composeMemoirBadges } from '../lib/annual-memoir-badges'
import { describeMemoirPage } from '../lib/annual-memoir-art'

test('the number and placement of badge images stay stable without duplicates or invented images', () => {
  const badges = Array.from({ length: 18 }, (_, index) => ({
    id: String(index), name: '勋章 ' + index, imageUrl: '/badge-' + index + '.png',
  }))
  for (const count of [0, 1, 2, 3, 4, 5, 6, 18]) {
    const source = badges.slice(0, count)
    const result = composeMemoirBadges(source, 'user-a:2026')
    assert.equal(result.length, Math.min(6, count))
    assert.equal(new Set(result.map(({ id }) => id)).size, result.length)
    assert.deepEqual(result, composeMemoirBadges(source.toReversed(), 'user-a:2026'))
    for (const { x, y, size, angle } of result) {
      const radius = size * (Math.abs(Math.cos(angle * Math.PI / 180)) + Math.abs(Math.sin(angle * Math.PI / 180))) / 2
      assert.ok(Math.abs(angle) <= 15 && x - radius > 130 && x + radius < 950 && y - radius > 496 && y + radius < 1326)
    }
    if (count >= 2) {
      assert.ok(new Set(result.map(({ size }) => size)).size > 1)
      assert.ok(new Set(result.map(({ angle }) => angle)).size > 1)
    }
  }
  assert.notDeepEqual(composeMemoirBadges(badges, 'user-a:2026'), composeMemoirBadges(badges, 'user-b:2026'))
})

test('ticket text keeps units with the metric across zero, different digit counts and old snapshots', () => {
  const report = { nickname: '阿晴', uid: 42, registered: '2026-08-01', title: '', message: '' }
  for (const value of [0, 2, 15, 128]) {
    const ticket = describeMemoirPage({ ...report, topics: value, offlineMeetups: value }, 7)
    assert.match(ticket, new RegExp(value + ' 场'))
    assert.match(ticket, new RegExp(value + ' 次'))
  }
  assert.match(describeMemoirPage({ ...report, badges: 4 }, 6), /4 枚获得的勋章/)
})
