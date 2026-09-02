import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseNotificationReplyTarget } from '../lib/notification-target'

const read = (path: string) => readFileSync(path, 'utf8')

test('挂号回复通知支持稳定 ID 与历史参数别名', () => {
  const parsed = parseNotificationReplyTarget({
    id: 'n1',
    source: 'personal',
    type: 'REPLY',
    link: '/checkin?date=2026-08-25&messageId=message-1&replyId=reply-9',
    targetUrl: null,
  })
  assert.deepEqual(parsed, {
    kind: 'daily-message',
    resourceId: 'message-1',
    parentId: 'reply-9',
    date: '2026-08-25',
  })
})

test('挂号详情按回复反查主留言和业务日期，并区分目标状态', () => {
  const service = read('lib/checkin-messages.ts')
  const page = read('app/checkin/page.tsx')
  const panel = read('components/CheckInMessagesPanel.tsx')

  assert.match(service, /resolveCheckInNotificationTarget/)
  assert.match(service, /DailyMessage: \{ select: checkInNotificationMessageSelect \}/)
  assert.match(service, /'FOUND' \| 'DELETED' \| 'NOT_FOUND' \| 'FORBIDDEN'/)
  assert.match(service, /export type CheckInReplyStatus = 'visible' \| 'deleted' \| 'not-found' \| 'unavailable'/)
  assert.match(page, /resolveCheckInNotificationTarget\(\{[\s\S]*viewerId: sessionUser\.id/)
  assert.match(page, /if \(replyStatus === 'not-found'\) focusErrorKind = 'NOT_FOUND'/)
  assert.match(panel, /该回复不存在或已失效/)
  assert.match(panel, /你暂时无法查看这条回复/)
})

test('目标回复超出第一页时仍加载精确回复和祖先链', () => {
  const service = read('lib/checkin-messages.ts')
  assert.match(service, /where: \{ id: focusCommentId, messageId, isDeleted: false \}/)
  assert.match(service, /while \(parentId && focusedComments\.length < 20/)
  assert.match(service, /DailyMessageComment: \[\.\.\.row\.DailyMessageComment, \.\.\.focusedCommentsForDisplay\]/)
})

test('本人或好友区域的精确留言只注入所属面板，并向好友面板传递 focus', () => {
  const page = read('app/checkin/page.tsx')
  const layout = read('components/CheckInPageSurface.tsx')

  assert.match(page, /let friendMessagesForDisplay = friendMessages\.messages/)
  assert.match(page, /const isFriendTarget = focusedMessage\.userId === sessionUser\.id/)
  assert.match(page, /friendMessagesForDisplay = friendMessages\.messages\.some/)
  assert.match(layout, /focusScope === 'friends' \? focusMessageId : undefined/)
  assert.match(layout, /focusScope === 'friends' \? focusCommentId : undefined/)
})

test('楼中楼深链会展开完整线程并只执行一次滚动高亮，通知水合按当前用户权限判断', () => {
  const panel = read('components/CheckInMessagesPanel.tsx')
  const notifications = read('lib/notifications.ts')

  assert.match(panel, /const handledFocusKeyRef = useRef\(''\)/)
  assert.match(panel, /const visibleThreadComments = isFocusedMessage && focusCommentId\s*\? threadComments/)
  assert.match(panel, /handledFocusKeyRef\.current === focusKey/)
  assert.match(panel, /data-checkin-reply-id=\{comment\.id\}/)
  assert.match(notifications, /loadDailyNotificationComments\(dailyTargets, 'list'\)/)
  assert.match(notifications, /row\.DailyMessage\.userId === viewerId/)
})

test('通知头像打开共享资料卡且不会冒泡触发通知正文跳转', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const card = read('components/FriendProfileCard.tsx')

  assert.match(client, /<FriendProfileCard/)
  assert.match(client, /event\.stopPropagation\(\)/)
  assert.match(client, /setSelectedActor\(\{[\s\S]*?friend: actorCardFriend,[\s\S]*?unavailable: item\.actorUnavailable/)
  assert.match(client, /new CustomEvent\('friend-dock:open', \{ detail: \{ action: 'chat', friend \} \}\)/)
  assert.match(card, /showMessage && onMessage \? <button[^>]*>发私信<\/button>/)
})

test('通知 actor 资料使用批量好友关系和公开字段，不返回账户敏感字段', () => {
  const service = read('lib/notifications.ts')
  assert.match(service, /const \[remarkResult, likeCountResult, actorBadgeResult, friendshipResult, actorRequestResult, growthLevelResult\]/)
  assert.match(service, /prisma\.friendship\.findMany\([\s\S]*select: \{ userAId: true, userBId: true \}/)
  assert.match(service, /const relationshipStatus = actor\?\.id === userId[\s\S]*OUTGOING_PENDING[\s\S]*INCOMING_PENDING/)
  assert.match(service, /actorProfile: FriendDockUser \| null/)

  const actorHydrationStart = service.indexOf('personalIds.length ? prisma.notification.findMany')
  const actorHydrationEnd = service.indexOf('systemIds.length ? prisma.systemNotification.findMany', actorHydrationStart)
  const actorSelect = service.slice(actorHydrationStart, actorHydrationEnd)
  assert.doesNotMatch(actorSelect, /\b(phone|email|passwordHash|username|role|token|secret)\s*:/)
})
