import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { planFriendCheckInMessagePage } from '../lib/checkin-message-order'

const read = (path: string) => readFileSync(path, 'utf8')

test('好友关注使用独立单向模型和唯一约束，不修改 Friendship', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260814160000_add_friend_follows/migration.sql')

  assert.match(schema, /model FriendFollow\s*\{[\s\S]*?followerId\s+String[\s\S]*?followedId\s+String[\s\S]*?@@unique\(\[followerId, followedId\]\)/)
  assert.match(migration, /CREATE TABLE `FriendFollow`/)
  assert.match(migration, /FriendFollow_followerId_followedId_key/)
  assert.doesNotMatch(schema, /model Friendship \{[\s\S]*?isFollowed/)
})

test('关注 API 服务端验证目标用户、自己关系和 Friendship，并以 upsert 保证幂等', () => {
  const route = read('app/api/friends/[userId]/follow/route.ts')

  assert.match(route, /requireUser\(\)/)
  assert.match(route, /userId === viewer\.id/)
  assert.match(route, /prisma\.user\.findFirst/)
  assert.match(route, /normalizeFriendPair\(viewer\.id, target\.id\)/)
  assert.match(route, /tx\.friendship\.findUnique/)
  assert.match(route, /tx\.friendFollow\.upsert/)
  assert.match(route, /friendFollow\.deleteMany/)
  assert.doesNotMatch(route, /notification\.create|emitRealtime/)
})

test('删除好友事务同时删除 Friendship 和双方 FriendFollow，且不通知、不删除历史内容', () => {
  const route = read('app/api/friends/[userId]/route.ts')

  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /tx\.friendship\.deleteMany/)
  assert.match(route, /tx\.friendFollow\.deleteMany/)
  assert.match(route, /followerId: userId, followedId: viewer\.id/)
  assert.doesNotMatch(route, /notification\.create|emitRealtime|directMessage\.delete|dailyMessage\.delete|post\.delete/)
})

test('好友主页提供删除好友、二次确认，并将关注放在 TA 的现场左侧', () => {
  const surface = read('components/ProfilePageSurface.tsx')
  const actions = read('components/FriendProfileActions.tsx')
  const profile = read('app/user/[uid]/page.tsx')

  assert.doesNotMatch(surface, />已好友</)
  assert.match(surface, /<FriendProfileActions/)
  assert.match(actions, /删除好友/)
  assert.match(actions, /title="确定删除该好友吗？"/)
  assert.match(actions, /<FriendFollowButton[\s\S]*onChanged=\{setIsFollowed\}/)
  assert.ok(actions.indexOf('<FriendFollowButton') < actions.indexOf('TA的现场'))
  assert.match(profile, /FriendFollow\.findUnique/)
  assert.match(profile, /isFollowed/)
})

test('挂号留言快速关注按钮在用户名右侧，成功后隐藏并重新请求当前留言列表', () => {
  const panel = read('components/CheckInMessagesPanel.tsx')
  const button = read('components/FriendFollowButton.tsx')

  assert.match(panel, /fullIdentity \? <a[\s\S]*\{scope === 'friends'/)
  assert.match(panel, /<FriendFollowButton[\s\S]*compact[\s\S]*hideWhenFollowed/)
  assert.match(panel, /if \(nextFollowed\) void loadMessages\(date, sort, false, false, page\)/)
  assert.match(button, /if \(hideWhenFollowed && followed\) return null/)
})

test('服务端分组分页实现自己优先、关注次之、普通最后，且保持每页 7 或 5 条', () => {
  const service = read('lib/checkin-messages.ts')
  const api = read('app/api/checkin/messages/route.ts')

  assert.match(service, /ownCount: stickyMessage \? 1 : 0/)
  assert.match(service, /followedCount: followedTotal/)
  assert.match(service, /ordinaryCount: ordinaryTotal/)
  assert.match(service, /skip: offset/)
  assert.match(service, /take,/)
  assert.match(api, /CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE/)
  assert.match(api, /CHECK_IN_MESSAGE_PAGE_SIZE/)

  const page = planFriendCheckInMessagePage({ ownCount: 1, followedCount: 2, ordinaryCount: 2, page: 1, pageSize: 7 })
  assert.deepEqual(page.own, { offset: 0, take: 1 })
  assert.deepEqual(page.followed, { offset: 0, take: 2 })
  assert.deepEqual(page.ordinary, { offset: 0, take: 2 })
})

test('好友留言读取仍然以 Friendship 为权限范围，关注只影响排序', () => {
  const friends = read('lib/friends.ts')
  const route = read('app/api/checkin/messages/route.ts')
  const block = read('app/api/users/[userId]/block/route.ts')

  assert.match(friends, /prisma\.friendship\.findMany/)
  assert.match(route, /getFriendIds\(user\.id\)/)
  assert.match(block, /prisma\.friendFollow\.deleteMany/)
})
