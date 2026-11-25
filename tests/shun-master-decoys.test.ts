import assert from 'node:assert/strict'
import test from 'node:test'
import { pickDecoys, type DecoyCandidate } from '../lib/shun-decoys'

/**
 * Decoy matching: friends of the victim first, then recently active accounts,
 * always preferring the same public look as the real actor, and never hard
 * filtering by avatar — otherwise "custom avatar" becomes the tell.
 */

function candidate(id: string, options: { avatar?: boolean; tier?: number; lastActiveAt?: number } = {}): DecoyCandidate {
  return { id, hasAvatar: options.avatar ?? false, tier: options.tier ?? 0, lastActiveAt: options.lastActiveAt ?? 0 }
}

/** Deterministic draw: walks the pool in order without repeating. */
function sequentialDraw() {
  let cursor = 0
  return (max: number) => (cursor++) % Math.max(1, max)
}

test('a decoy set never contains the actor, the victim or a duplicate', () => {
  const pools = { friends: [], active: [candidate('a'), candidate('b'), candidate('c')], fallback: [] }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 2 }, 2, sequentialDraw(), ['victim'])
  assert.equal(decoys.length, 2)
  assert.equal(new Set(decoys).size, 2, '两个干扰者不得重复')
  assert.ok(!decoys.includes('actor'), '不得把顺取者本人列为干扰者')
  assert.ok(!decoys.includes('victim'), '不得把被顺者本人列为干扰者')
})

test('the golden window needs one decoy, the wide window needs two', () => {
  const pools = { friends: [], active: ['x', 'y', 'z'].map((id) => candidate(id)), fallback: [] }
  assert.equal(pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 1 }, 1, sequentialDraw(), ['v']).length, 1)
  assert.equal(pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 1 }, 2, sequentialDraw(), ['v']).length, 2)
})

test('the victim’s friends are used before the site-wide pool', () => {
  const pools = {
    friends: [candidate('f1'), candidate('f2'), candidate('f3')],
    active: [candidate('a1'), candidate('a2')],
    fallback: [candidate('z1')],
  }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 2 }, 2, sequentialDraw(), ['victim'])
  assert.ok(decoys.every((id) => id.startsWith('f')), '有合格好友时必须优先用好友')
  assert.equal(decoys.length, 2)
})

test('without eligible friends the recent-activity pool is used', () => {
  const pools = { friends: [], active: [candidate('a1'), candidate('a2')], fallback: [candidate('z1')] }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 2 }, 2, sequentialDraw(), ['victim'])
  assert.deepEqual(new Set(decoys), new Set(['a1', 'a2']))
})

test('when nobody is recently active the legacy pool still fills the options', () => {
  const pools = { friends: [], active: [candidate('a1')], fallback: [candidate('z1'), candidate('z2')] }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 0 }, 2, sequentialDraw(), ['victim'])
  assert.equal(decoys.length, 2, '活跃用户不足时必须回退到原有候选池')
  assert.ok(decoys.includes('a1'))
  assert.ok(decoys.some((id) => id.startsWith('z')), '回退池必须补足人数')
})

test('a custom-avatar actor gets custom-avatar decoys when they exist', () => {
  const pools = {
    friends: [candidate('f-plain-1'), candidate('f-plain-2'), candidate('f-custom-1', { avatar: true })],
    active: [candidate('a-plain'), candidate('a-custom', { avatar: true })],
    fallback: [],
  }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: true, tier: 3 }, 2, sequentialDraw(), ['victim'])
  assert.ok(decoys.includes('f-custom-1'), '同款自定义头像的好友必须优先')
  assert.equal(decoys.length, 2)
})

test('a default-avatar actor is not always paired with high-activity custom avatars', () => {
  const custom = Array.from({ length: 6 }, (_, index) => candidate(`c${index}`, { avatar: true, tier: 4 }))
  const plain = Array.from({ length: 6 }, (_, index) => candidate(`p${index}`, { tier: 2 }))
  const pools = { friends: [], active: [...custom, ...plain], fallback: [] }
  let customPairs = 0
  const draws = 200
  for (let seed = 0; seed < draws; seed += 1) {
    // Rotate the draw so the sample does not depend on one start index.
    let cursor = seed
    const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: false, tier: 2 }, 2, (max) => (cursor++) % Math.max(1, max), ['victim'])
    if (decoys.every((id) => id.startsWith('c'))) customPairs += 1
  }
  const share = customPairs / draws
  // The same-look rule is a preference, not a filter: pairing a plain actor with
  // a custom-avatar decoy must stay possible (otherwise it becomes the tell),
  // but it must not be the default outcome either.
  assert.ok(share < 0.45, `默认头像顺取者被固定搭配自定义头像的比例过高：${(share * 100).toFixed(0)}%`)
  assert.ok(share > 0.02, `自定义头像不得被完全排除，否则头像本身就成了新的识别规律：${(share * 100).toFixed(0)}%`)
})

test('default-avatar accounts are still eligible as decoys', () => {
  const pools = { friends: [], active: [candidate('p1'), candidate('p2')], fallback: [] }
  const decoys = pickDecoys(pools, { id: 'actor', hasAvatar: true, tier: 4 }, 2, sequentialDraw(), ['victim'])
  assert.equal(decoys.length, 2, '不得为了头像匹配而排除默认头像用户')
})

test('simulated populations show a healthy mix of friends, activity and avatars', () => {
  const actorProfiles = [
    { hasAvatar: true, tier: 4 }, { hasAvatar: false, tier: 0 },
  ]
  const stats = { draws: 0, fromFriends: 0, avatarMatched: 0, emptyFallback: 0 }
  for (const actor of actorProfiles) {
    for (let seed = 0; seed < 300; seed += 1) {
      const friends = Array.from({ length: seed % 4 }, (_, index) =>
        candidate(`f${seed}-${index}`, { avatar: index % 2 === 0, tier: index % 5 }))
      const active = Array.from({ length: 6 }, (_, index) =>
        candidate(`a${seed}-${index}`, { avatar: index % 3 === 0, tier: (index + 2) % 5 }))
      const fallback = [candidate(`z${seed}`)]
      let cursor = seed
      const decoys = pickDecoys({ friends, active, fallback }, { id: 'actor', ...actor }, 2,
        (max) => (cursor++) % Math.max(1, max), ['victim'])
      stats.draws += 1
      if (decoys.some((id) => id.startsWith('f'))) stats.fromFriends += 1
      const pool = [...friends, ...active, ...fallback]
      if (decoys.every((id) => pool.find((item) => item.id === id)?.hasAvatar === actor.hasAvatar)) stats.avatarMatched += 1
      if (decoys.length < 2) stats.emptyFallback += 1
    }
  }
  assert.equal(stats.emptyFallback, 0, '任何组合都必须凑够两位不同的干扰者')
  assert.ok(stats.fromFriends / stats.draws > 0.6, '有好友时大多数抽取必须来自好友池')
  console.log('SHUN_DECOY_SIM', JSON.stringify(stats))
})
