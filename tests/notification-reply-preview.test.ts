import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatNotificationReplyPreview } from '../lib/notifications'

const read = (path: string) => readFileSync(path, 'utf8')

test('通知回复预览来自真实正文，并为图片/表情提供安全占位', () => {
  assert.equal(formatNotificationReplyPreview({ content: '哈哈哈\n@Easonlove0916' }), '哈哈哈\n@Easonlove0916')
  assert.equal(formatNotificationReplyPreview({ content: '[[content-image:/storage/reply.webp]]' }), '[图片]')
  assert.equal(formatNotificationReplyPreview({ content: '', stickerId: 'sticker-1' }), '[表情]')
  assert.equal(formatNotificationReplyPreview({ content: '收到', stickerId: 'sticker-1', hasImages: true }), '收到 [图片] [表情]')
  assert.equal(formatNotificationReplyPreview({ content: '违规原文', moderationStatus: 'VIOLATION' }), '违规内容')
})

test('通知卡片只渲染有内容的标签，并使用三行回复预览', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const css = read('app/globals.css')

  assert.match(client, /hasDisplayLabel = Boolean\(displayLabel\?\.trim\(\)\)/)
  assert.match(client, /hasDisplayLabel \? <span/)
  assert.match(client, /item\.replyPreview\?\.trim\(\)/)
  assert.match(css, /\.notification-reply-preview \{[\s\S]*-webkit-line-clamp: 3/)
  assert.match(css, /\.notification-reply-editor textarea,[\s\S]*box-sizing: border-box/)
})

test('通知中心快速回复沿用帖子回复 API 的楼中楼与富内容参数', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const composer = read('components/NotificationReplyComposer.tsx')

  assert.match(client, /parentId: target\.parentId/)
  assert.match(client, /imageUrls: payload\.imageUrls/)
  assert.match(client, /mentions: payload\.mentions/)
  assert.match(client, /stickerId: payload\.stickerId/)
  assert.match(client, /item\.type === 'REPLY' \|\| item\.category === 'feedback'/)
  assert.match(composer, /FriendMentionInput/)
  assert.match(composer, /ContentImageUploader/)
  assert.match(composer, /StickerPicker/)
  assert.match(composer, /event\.stopPropagation\(\)/)
})

test('服务端从 focus 关联的真实回复读取正文，不向 Notification 增加重复正文字段', () => {
  const service = read('lib/notifications.ts')
  const schema = read('prisma/schema.prisma')

  assert.match(service, /parseNotificationReplyTarget/)
  assert.match(service, /content: true, moderationStatus: true, stickerId: true, isDeleted: true/)
  assert.match(service, /replyPreview: formatNotificationReplyPreview/)
  assert.match(service, /REPLY_UNAVAILABLE_TEXT/)
  assert.match(schema.slice(schema.indexOf('model Notification'), schema.indexOf('model Notification') + 1000), /link\s+String\?/)
  assert.doesNotMatch(schema.slice(schema.indexOf('model Notification'), schema.indexOf('model Notification') + 1000), /replyId|metadata/)
})
