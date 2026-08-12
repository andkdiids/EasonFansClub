import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeFriendCheckInMessages } from '../lib/checkin-message-order'

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

test('服务端把本人留言作为独立 sticky 查询，好友分页不使用本人 offset', () => {
  const service = readFileSync('lib/checkin-messages.ts', 'utf8')
  const api = readFileSync('app/api/checkin/messages/route.ts', 'utf8')
  const page = readFileSync('app/checkin/page.tsx', 'utf8')

  assert.match(service, /stickyUserId\?: string/)
  assert.match(service, /const friendUserIds = \[\.\.\.new Set\(userIds\)\]\.filter\(\(userId\) => userId !== stickyUserId\)/)
  assert.match(service, /userIds: \[stickyUserId\]/)
  assert.match(service, /orderByCreatedAtDesc: true/)
  assert.match(service, /const totalPages = Math\.max\(1, Math\.ceil\(friendTotal \/ safePageSize\)\)/)
  assert.match(service, /stickyMessage && safePage === 1/)
  assert.match(api, /stickyUserId: scope === 'friends' \? user\.id : undefined/)
  assert.match(page, /stickyUserId: sessionUser\.id/)
})

test('挂号成功事件只把本人的留言送入好友面板第一页并触发同步', () => {
  const panel = readFileSync('components/CheckInMessagesPanel.tsx', 'utf8')

  assert.match(panel, /if \(scope === 'friends'\)/)
  assert.match(panel, /checkInMessageAuthorId\(displayMessage\) !== sessionUserIdRef\.current/)
  assert.match(panel, /setPage\(1\)/)
  assert.match(panel, /setMessages\(\[displayMessage\]\)/)
  assert.match(panel, /void loadMessages\(nextDate, sort, true, true, 1\)/)
  assert.match(panel, /normalizeFriendCheckInMessages\(merged, nextPage, sessionUserIdRef\.current\)/)
})
