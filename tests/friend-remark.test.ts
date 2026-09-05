import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('FriendRemark 使用单向 owner/friend 关系并提供唯一约束', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260810090000_add_friend_remarks/migration.sql')

  assert.match(schema, /model FriendRemark\s*\{[\s\S]*?ownerId\s+String[\s\S]*?friendId\s+String[\s\S]*?@@unique\(\[ownerId, friendId\]\)/)
  assert.match(migration, /CREATE UNIQUE INDEX `FriendRemark_ownerId_friendId_key` ON `FriendRemark` \(`ownerId`, `friendId`\)/)
  assert.match(migration, /FOREIGN KEY \(`ownerId`\) REFERENCES `User`\(`id`\)/)
  assert.match(migration, /FOREIGN KEY \(`friendId`\) REFERENCES `User`\(`id`\)/)
})

test('备注 API 只允许有效好友本人修改，空值删除备注', () => {
  const route = read('app/api/friends/[userId]/remark/route.ts')

  assert.match(route, /requireUser\(\)/)
  assert.match(route, /userId === viewer\.id/)
  assert.match(route, /prisma\.friendship\.findUnique/)
  assert.match(route, /if \(!friendship \|\| block\)/)
  assert.match(route, /prisma\.friendRemark\.deleteMany/)
  assert.match(route, /ownerId_friendId/)
})

test('显示名解析按 viewer 读取备注，profile context 保留公开昵称', () => {
  const resolver = read('lib/friend-display-name.ts')
  const remarkResolver = read('lib/friend-display.ts')
  const profilePage = read('app/user/[uid]/page.tsx')

  assert.match(resolver, /export function getFriendDisplayName\(/)
  assert.match(remarkResolver, /context !== 'profile'/)
  assert.match(remarkResolver, /loadFriendRemarkMap/)
  assert.match(resolver, /nickname\?\.trim\(\) \|\| PUBLIC_USER_FALLBACK_NAME/)
  assert.match(profilePage, /const name = getPublicUserDisplayName\(user\)/)
  assert.match(profilePage, /FriendRemarkEditor targetUserId=\{user\.id\}/)
})

test('备注显示出口使用批量 map，mention 仍返回真实 userId', () => {
  const mentions = read('app/api/friends/mentions/route.ts')
  const replyPage = read('app/posts/[postId]/page.tsx')
  const notifications = read('lib/notifications.ts')

  assert.match(mentions, /loadFriendRemarkMap\(user\.id, friendIds\)/)
  assert.doesNotMatch(replyPage, /loadFriendRemarkMap/)
  assert.match(replyPage, /getPublicUserDisplayName\(mentionedUser\)/)
  assert.match(replyPage, /id: mentionedUser\.id/)
  assert.match(notifications, /loadFriendRemarkMap\(userId, actorIds\)/)
})
