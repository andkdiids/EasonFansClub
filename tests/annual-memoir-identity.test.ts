import assert from 'node:assert/strict'
import test from 'node:test'
import { memoirIdentity } from '../lib/annual-memoir-identity'

test('identity follows a stable priority across eight real activity profiles', () => {
  const empty = { posts: 0, replies: 0, friends: 0, interactions: 0, games: 0, badges: 0, activities: 0, activeDays: 0 }
  assert.equal(memoirIdentity(empty), '故事刚刚开始')
  assert.equal(memoirIdentity({ ...empty, activeDays: 1 }), '默默陪伴者')
  assert.equal(memoirIdentity({ ...empty, posts: 5 }), '故事记录者')
  assert.equal(memoirIdentity({ ...empty, interactions: 6 }), '最佳损友')
  assert.equal(memoirIdentity({ ...empty, games: 5 }), '游戏冒险家')
  assert.equal(memoirIdentity({ ...empty, badges: 3 }), '勋章收藏家')
  assert.equal(memoirIdentity({ ...empty, activities: 3 }), '活动探索家')
  assert.equal(memoirIdentity({ ...empty, posts: 5, games: 5 }), '故事记录者')
  assert.equal(memoirIdentity({ ...empty, posts: 5, games: 5, activities: 3 }), 'E院气氛担当')
})
