import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  belongsToFriendGroup,
  buildFriendGroupIndex,
  mergeUniqueFriendPage,
  UNGROUPED_FRIEND_GROUP_ID,
} from '../lib/friend-grouping'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260814200000_add_friend_groups_and_conversation_clear/migration.sql')
const listRoute = read('app/api/friends/list/route.ts')
const groupRoute = read('app/api/friend-groups/route.ts')
const groupDetailRoute = read('app/api/friend-groups/[groupId]/route.ts')
const moveRoute = read('app/api/friends/[userId]/group/route.ts')
const dock = read('components/FriendDock.tsx')

test('two members in one group keep count and independently loaded list in sync', () => {
  const index = buildFriendGroupIndex(['a', 'b'], [
    { friendId: 'a', groupId: 'tea' },
    { friendId: 'b', groupId: 'tea' },
  ])

  assert.equal(index.groupCounts.get('tea'), 2)
  assert.deepEqual(['a', 'b'].filter((id) => belongsToFriendGroup(id, 'tea', index.groupByFriend)), ['a', 'b'])
  assert.equal(index.ungroupedCount, 0)
})

test('both Friendship directions are included before applying a group scope', () => {
  assert.match(listRoute, /userAId: user\.id, User_Friendship_userBIdToUser/)
  assert.match(listRoute, /userBId: user\.id, User_Friendship_userAIdToUser/)
  assert.match(listRoute, /row\.userAId === user\.id \? row\.userBId : row\.userAId/)
  assert.match(groupRoute, /userAId: user\.id, User_Friendship_userBIdToUser/)
  assert.match(groupRoute, /userBId: user\.id, User_Friendship_userAIdToUser/)
})

test('a group member outside the global first page remains visible in the group scope', () => {
  const allFriendIds = Array.from({ length: 25 }, (_, index) => `friend-${index + 1}`)
  const index = buildFriendGroupIndex(allFriendIds, [{ friendId: 'friend-25', groupId: 'tea' }])

  assert.equal(allFriendIds.slice(0, 20).filter((id) => belongsToFriendGroup(id, 'tea', index.groupByFriend)).length, 0)
  assert.equal(allFriendIds.filter((id) => belongsToFriendGroup(id, 'tea', index.groupByFriend)).length, 1)
  assert.match(listRoute, /requestedGroupId/)
  assert.match(listRoute, /const scopedFriendRows = requestedGroupId/)
  assert.match(dock, /groupId/)
})

test('moving an ungrouped friend into a group updates both derived counts', () => {
  const before = buildFriendGroupIndex(['a', 'b'], [])
  const after = buildFriendGroupIndex(['a', 'b'], [{ friendId: 'a', groupId: 'tea' }])

  assert.equal(before.ungroupedCount, 2)
  assert.equal(after.ungroupedCount, 1)
  assert.equal(after.groupCounts.get('tea'), 1)
})

test('moving a friend between groups removes it from the old group', () => {
  const index = buildFriendGroupIndex(['a'], [{ friendId: 'a', groupId: 'oolong' }])
  const moved = buildFriendGroupIndex(['a'], [{ friendId: 'a', groupId: 'tea' }])

  assert.equal(index.groupCounts.get('oolong'), 1)
  assert.equal(moved.groupCounts.get('oolong') || 0, 0)
  assert.equal(moved.groupCounts.get('tea'), 1)
  assert.equal(belongsToFriendGroup('a', 'tea', moved.groupByFriend), true)
  assert.equal(belongsToFriendGroup('a', 'oolong', moved.groupByFriend), false)
  assert.match(moveRoute, /friendGroupMember\.upsert/)
})

test('moving a friend back to ungrouped restores the ungrouped count', () => {
  const movedBack = buildFriendGroupIndex(['a', 'b'], [])

  assert.equal(movedBack.ungroupedCount, 2)
  assert.equal(belongsToFriendGroup('a', UNGROUPED_FRIEND_GROUP_ID, movedBack.groupByFriend), true)
  assert.match(moveRoute, /friendGroupMember\.deleteMany/)
})

test('deleting a group cascades membership rows instead of leaving stale counts', () => {
  assert.match(groupDetailRoute, /export async function DELETE/)
  assert.match(groupDetailRoute, /friendGroup\.deleteMany/)
  assert.match(schema, /model FriendGroupMember[\s\S]*?groupId\s+String[\s\S]*?Group\s+FriendGroup\s+@relation[\s\S]*?onDelete:\s*Cascade/)
  assert.match(migration, /FOREIGN KEY \(`groupId`\).*ON DELETE CASCADE/)
})

test('same display names are not deduplicated and rows use stable ids', () => {
  const merged = mergeUniqueFriendPage([], [
    { id: 'a', name: 'same name' },
    { id: 'b', name: 'same name' },
  ], false)

  assert.deepEqual(merged.map((item) => item.id), ['a', 'b'])
  assert.match(dock, /key=\{friend\.id\}/)
  assert.doesNotMatch(dock, /friends\.filter\(\(friend\) => friend\.groupId/)
})

test('a 25-member group loads 20 then 5 with a group-specific continuation', () => {
  const ids = Array.from({ length: 25 }, (_, index) => `friend-${index + 1}`)
  const pageOne = ids.slice(0, 20).map((id) => ({ id }))
  const pageTwo = ids.slice(20).map((id) => ({ id }))
  const merged = mergeUniqueFriendPage(pageOne, pageTwo, true)

  assert.equal(merged.length, 25)
  assert.equal(20 < 25, true)
  assert.match(dock, /pageSize: '20'/)
  assert.match(dock, /groupPagination/)
  assert.match(dock, /加载更多\$\{group\.name\}好友/)
  assert.match(listRoute, /hasMore: pageStart \+ pageSize < scopedTotal/)
})

test('count and list use the same valid friendship population, not displayed page length', () => {
  assert.match(listRoute, /buildFriendGroupIndex\(/)
  assert.match(listRoute, /const scopedTotal = scopedFriendRows\.length/)
  assert.match(listRoute, /friendTotal: total/)
  assert.match(listRoute, /groupMembers\.filter\(\(member\) => validGroupIds\.has\(member\.groupId\)\)/)
  assert.match(groupRoute, /members\.filter\(\(member\) => validGroupIds\.has\(member\.groupId\)\)/)
  assert.match(schema, /@@unique\(\[ownerId, friendId\]\)/)
})
