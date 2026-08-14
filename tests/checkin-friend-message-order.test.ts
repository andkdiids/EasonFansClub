import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeFriendCheckInMessages, planFriendCheckInMessagePage } from '../lib/checkin-message-order'

type Message = {
  id: string
  createdAt: string
  author: { id: string }
}

const message = (id: string, authorId: string, createdAt: string): Message => ({
  id,
  createdAt,
  author: { id: authorId },
})

test('本人留言时间最早时仍固定在好友挂号留言第一页顶部', () => {
  const result = normalizeFriendCheckInMessages([
    message('friend-a', 'friend-a', '2026-08-12T10:00:00.000Z'),
    message('friend-b', 'friend-b', '2026-08-12T09:00:00.000Z'),
    message('self', 'self', '2026-08-12T08:00:00.000Z'),
  ], 1, 'self')

  assert.deepEqual(result.map((item) => item.id), ['self', 'friend-a', 'friend-b'])
})

test('本人留言时间最新时仍只出现一次并固定在顶部', () => {
  const result = normalizeFriendCheckInMessages([
    message('self', 'self', '2026-08-12T12:00:00.000Z'),
    message('friend-a', 'friend-a', '2026-08-12T11:00:00.000Z'),
  ], 1, 'self')

  assert.deepEqual(result.map((item) => item.id), ['self', 'friend-a'])
})

test('没有本人留言时保留好友原有时间排序', () => {
  const input = [
    message('friend-a', 'friend-a', '2026-08-12T10:00:00.000Z'),
    message('friend-b', 'friend-b', '2026-08-12T09:00:00.000Z'),
  ]

  assert.deepEqual(normalizeFriendCheckInMessages(input, 1, 'self'), input)
})

test('分页第二页不重复展示本人，并且保留全部好友留言', () => {
  const result = normalizeFriendCheckInMessages([
    message('self', 'self', '2026-08-12T08:00:00.000Z'),
    message('friend-c', 'friend-c', '2026-08-12T07:00:00.000Z'),
  ], 2, 'self')

  assert.deepEqual(result.map((item) => item.id), ['friend-c'])
})

test('历史异常存在多条本人留言时只保留最新一条置顶', () => {
  const result = normalizeFriendCheckInMessages([
    message('self-old', 'self', '2026-08-12T08:00:00.000Z'),
    message('friend-a', 'friend-a', '2026-08-12T09:00:00.000Z'),
    message('self-new', 'self', '2026-08-12T10:00:00.000Z'),
  ], 1, 'self')

  assert.deepEqual(result.map((item) => item.id), ['self-new', 'friend-a'])
})

test('服务端按本人、关注好友、普通好友三组计算固定大小分页', () => {
  const service = readFileSync('lib/checkin-messages.ts', 'utf8')
  const api = readFileSync('app/api/checkin/messages/route.ts', 'utf8')
  const page = readFileSync('app/checkin/page.tsx', 'utf8')

  assert.match(service, /followedUserIds\?: string\[\]/)
  assert.match(service, /planFriendCheckInMessagePage/)
  assert.match(service, /appendGroup\(followedFriendUserIds, plan\.followed\.offset, plan\.followed\.take\)/)
  assert.match(service, /appendGroup\(ordinaryFriendUserIds, plan\.ordinary\.offset, plan\.ordinary\.take\)/)
  assert.match(api, /getFriendFollowedIds\(user\.id, friendIds\)/)
  assert.match(api, /followedUserIds/)
  assert.match(page, /getFriendFollowedIds\(sessionUser\.id, friendIds\)/)
  assert.match(page, /followedUserIds: followedFriendIds/)
})

test('本人、关注、普通三组分页不会把关注好友留在后页', () => {
  const firstPage = planFriendCheckInMessagePage({ ownCount: 1, followedCount: 1, ordinaryCount: 20, page: 1, pageSize: 7 })
  assert.deepEqual(firstPage.own, { offset: 0, take: 1 })
  assert.deepEqual(firstPage.followed, { offset: 0, take: 1 })
  assert.deepEqual(firstPage.ordinary, { offset: 0, take: 5 })

  const sixthPage = planFriendCheckInMessagePage({ ownCount: 1, followedCount: 1, ordinaryCount: 40, page: 6, pageSize: 7 })
  assert.deepEqual(sixthPage.followed, { offset: 1, take: 0 })
  assert.deepEqual(sixthPage.ordinary, { offset: 33, take: 7 })
})

test('挂号成功事件只把本人的留言送入好友面板第一页并触发同步', () => {
  const panel = readFileSync('components/CheckInMessagesPanel.tsx', 'utf8')

  assert.match(panel, /if \(scope === 'friends'\)/)
  assert.match(panel, /checkInMessageAuthorId\(displayMessage\) !== sessionUserIdRef\.current/)
  assert.match(panel, /setPage\(1\)/)
  assert.match(panel, /setMessages\(\[displayMessage\]\)/)
  assert.match(panel, /void loadMessages\(nextDate, sort, true, true, 1\)/)
  assert.match(panel, /FriendFollowButton/)
  assert.match(panel, /void loadMessages\(date, sort, false, false, page\)/)
  assert.doesNotMatch(panel, /normalizeFriendCheckInMessages\(merged, nextPage, sessionUserIdRef\.current\)/)
})
