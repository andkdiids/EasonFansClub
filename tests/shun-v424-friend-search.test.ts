import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesTargetFriend, type TargetFriendView } from '../lib/shun-friend-search.ts'

const friends: TargetFriendView[] = [
  { id: 'clid_a1', uid: 7, nickname: '小顺顺', displayName: '小顺顺', remark: '同桌' },
  { id: 'clid_b2', uid: 42, nickname: 'EFMaster', displayName: 'EFMaster', remark: null },
  { id: 'clid_c3', uid: 10086, nickname: '阿明', displayName: '阿明', remark: '大学室友' },
]

test('V4.2.4 好友搜索支持昵称与备注，英文不区分大小写', () => {
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '  小顺  ')).map((f) => f.uid), [7])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, 'efmaster')).map((f) => f.uid), [42])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '大学室友')).map((f) => f.uid), [10086])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '  ')).map((f) => f.uid), [7, 42, 10086])
})

test('V4.2.4 好友搜索支持完整/部分 UID、好友 ID 与前导零', () => {
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '7')).map((f) => f.uid), [7])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '007')).map((f) => f.uid), [7])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '100')).map((f) => f.uid), [10086])
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, 'clid_b2')).map((f) => f.uid), [42])
})

test('V4.2.4 好友搜索只使用传入的候选集，不能凭空造出好友', () => {
  const eligible = friends.slice(0, 2)
  assert.deepEqual(eligible.filter((f) => matchesTargetFriend(f, '阿明')), [])
  assert.deepEqual(eligible.filter((f) => matchesTargetFriend(f, '大学室友')), [])
  // A remark belongs to the viewer; no cross-user alias is consulted.
  assert.equal(matchesTargetFriend({ ...friends[0], remark: null }, '同桌'), false)
})

test('V4.2.4 无结果时返回空列表', () => {
  assert.deepEqual(friends.filter((f) => matchesTargetFriend(f, '不存在的昵称')), [])
})
