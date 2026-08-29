import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFriendConversationOrder } from '../lib/friend-conversation-order'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(path, 'utf8')

function row(input: Partial<Parameters<typeof compareFriendConversationOrder>[0]> = {}) {
  return {
    latestMessageAt: null,
    fallbackAt: new Date('2026-01-01T00:00:00.000Z'),
    stableId: 'friend-a',
    ...input,
  }
}

test('会话排序只按最后一条有效私信时间倒序', () => {
  const a = row({ latestMessageAt: new Date('2026-01-01T10:00:00.000Z'), stableId: 'a' })
  const b = row({ latestMessageAt: new Date('2026-01-01T10:10:00.000Z'), stableId: 'b' })
  const c = row({ latestMessageAt: new Date('2026-01-01T10:20:00.000Z'), stableId: 'c' })
  assert.deepEqual([c, b, a].sort(compareFriendConversationOrder), [c, b, a])
})

test('旧会话收到新消息后重新置顶，未读数量不参与排序', () => {
  const b = row({ latestMessageAt: new Date('2026-01-01T10:40:00.000Z'), stableId: 'b' })
  const aAfterMessage = row({ latestMessageAt: new Date('2026-01-01T10:50:00.000Z'), stableId: 'a' })
  assert.equal(compareFriendConversationOrder(aAfterMessage, b) < 0, true)
  assert.equal(compareFriendConversationOrder(b, aAfterMessage) > 0, true)
})

test('没有消息的好友排在有消息会话之后，并按好友关系时间稳定排序', () => {
  const withMessage = row({ latestMessageAt: new Date('2026-01-01T10:00:00.000Z'), stableId: 'chat' })
  const olderEmpty = row({ fallbackAt: new Date('2026-01-01T09:00:00.000Z'), stableId: 'old-empty' })
  const newerEmpty = row({ fallbackAt: new Date('2026-01-01T09:30:00.000Z'), stableId: 'new-empty' })
  assert.deepEqual([olderEmpty, withMessage, newerEmpty].sort(compareFriendConversationOrder), [withMessage, newerEmpty, olderEmpty])
})

test('服务端先全局排序再分页，且不使用已读状态或 updatedAt 排序', () => {
  const friendsList = source('app/api/friends/list/route.ts')
  const conversations = source('app/api/direct-conversations/route.ts')
  const messages = source('app/api/direct-conversations/[conversationId]/messages/route.ts')
  const dock = source('components/FriendDock.tsx')

  assert.match(friendsList, /const orderedFriendRows = scopedFriendRows[\s\S]*compareFriendConversationOrder[\s\S]*const pageStart = \(page - 1\) \* pageSize/)
  assert.match(friendsList, /const visibleRows = orderedFriendRows\.slice\(pageStart, pageStart \+ pageSize\)/)
  assert.doesNotMatch(friendsList, /Number\(b\.unreadCount > 0\)/)
  assert.match(conversations, /const conversations = conversationRows[\s\S]*compareFriendConversationOrder[\s\S]*\.slice\(0, 30\)/)
  assert.doesNotMatch(conversations, /orderBy: \[[^\]]*updatedAt/)
  assert.match(messages, /updateMany\([\s\S]*lastMessageAt: \{ lt: created\.createdAt \}/)
  assert.doesNotMatch(dock, /FRIEND_LIST_REFRESH_INTERVAL_MS = 3000/)
  assert.match(dock, /realtime:event/)
  assert.match(dock, /loadFriends\(1(?:,|\))/)
  assert.match(dock, /promoteFriendConversation\(conversationId, data\.message\)/)
})
