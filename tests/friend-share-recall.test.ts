import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canRecallDirectMessage,
  DIRECT_MESSAGE_RECALL_WINDOW_MS,
  isWithinDirectMessageRecallWindow,
} from '../lib/direct-message-recall'

const read = (path: string) => readFileSync(path, 'utf8')

test('撤回只允许发送者在 60 秒窗口内操作，并保留软状态幂等', () => {
  const now = new Date('2026-09-12T00:01:00.000Z')
  const message = { senderId: 'user-a', createdAt: new Date(now.getTime() - 30_000), isDeleted: false, type: 'TEXT', clientMessageId: 'client-1' }
  assert.equal(DIRECT_MESSAGE_RECALL_WINDOW_MS, 60_000)
  assert.equal(isWithinDirectMessageRecallWindow(message.createdAt, now), true)
  assert.equal(isWithinDirectMessageRecallWindow(new Date(now.getTime() - 61_000), now), false)
  assert.equal(canRecallDirectMessage(message, 'user-a', now).code, 'RECALLABLE')
  assert.equal(canRecallDirectMessage(message, 'user-b', now).code, 'NOT_SENDER')
  assert.equal(canRecallDirectMessage({ ...message, isDeleted: true }, 'user-a', now).code, 'ALREADY_RECALLED')
  assert.equal(canRecallDirectMessage({ ...message, type: 'SYSTEM' }, 'user-a', now).code, 'NOT_RECALLABLE')
  assert.equal(canRecallDirectMessage({ ...message, clientMessageId: 'friend-request:req-1' }, 'user-a', now).code, 'NOT_RECALLABLE')
})

test('帖子批量站内分享服务端逐个校验好友、限制 20 人并返回部分结果', () => {
  const sheet = read('components/share/PostShareSheet.tsx')
  const route = read('app/api/posts/[postId]/share/route.ts')
  assert.match(sheet, /const MAX_SHARE_RECIPIENTS = 20/)
  assert.match(sheet, /setSelectedFriends\(\(current\) =>/)
  assert.match(sheet, /disabled=\{!selectedFriends\.length \|\| Boolean\(sendingId\)\}/)
  assert.match(sheet, /clientMessageIdsRef/)
  assert.match(sheet, /failedRecipients/)
  assert.match(route, /const recipientIds = \[\.\.\.new Set\(/)
  assert.match(route, /recipientIds\.length > MAX_SHARE_RECIPIENTS/)
  assert.match(route, /await assertFriendShareTarget\(guard\.user\.id, recipientId\)/)
  assert.match(route, /results: results\.map/)
  assert.match(route, /recordContentShareTask\(tx, input\.senderId, input\.now\)/)
})

test('消息读取暴露撤回占位，撤回接口使用发送者与时间窗口的条件更新', () => {
  const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  const conversations = read('app/api/direct-conversations/route.ts')
  const recall = read('app/api/direct-conversations/[conversationId]/messages/[messageId]/recall/route.ts')
  assert.match(messages, /isDeleted: true/)
  assert.match(messages, /recalled: message\.isDeleted/)
  assert.match(messages, /postShare: message\.type === 'POST_SHARE' \? postShare \|\| null : null/)
  assert.match(conversations, /recalled: row\.DirectMessage\[0\]\.isDeleted/)
  assert.match(conversations, /if \(message\.isDeleted\) return '消息已撤回'/)
  assert.match(recall, /id: message\.id,[\s\S]*conversationId,[\s\S]*senderId: user\.id,[\s\S]*isDeleted: false/)
  assert.match(recall, /createdAt: \{ gte: getDirectMessageRecallCutoff\(now\), lte: now \}/)
  assert.match(recall, /data: \{ isDeleted: true \}/)
  assert.doesNotMatch(recall, /directMessage\.delete\(/)
})

test('选择表情包后立即调用已有私信发送链路，失败时保留可重试消息', () => {
  const dock = read('components/FriendDock.tsx')
  assert.match(dock, /function sendSticker\(sticker: PickerSticker\)/)
  assert.match(dock, /onSelectSticker=\{sendSticker\}/)
  assert.match(dock, /void sendMessage\(\{ content: '', clientMessageId, stickerId: sticker\.id, stickerUrl: sticker\.url \}\)/)
  assert.match(dock, /if \(success\) setPendingSticker\(/)
  assert.match(dock, /recalled \? \(/)
  assert.match(dock, /你撤回了一条消息/)
  assert.match(dock, /对方撤回了一条消息/)
})
