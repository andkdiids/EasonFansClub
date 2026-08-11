import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日处方只展示图片并通过分享菜单处理分享', () => {
  const source = read('components/games/SavePrescriptionButton.tsx')

  assert.doesNotMatch(source, /下载图片/)
  assert.doesNotMatch(source, /downloadBlob/)
  assert.doesNotMatch(source, /navigator\.canShare/)
  assert.match(source, /setPreview\(image\)/)
  assert.match(source, /shareMenuOpen/)
  assert.match(source, /分享给好友/)
  assert.match(source, /分享到朋友圈/)
  assert.match(source, /updateAppMessageShareData/)
  assert.match(source, /updateTimelineShareData/)
  assert.match(source, /navigator\.share/)
  assert.match(source, /copyShareLink/)
})

test('挂号通知会按留言和回复 ID 定向加载，不受默认分页窗口影响', () => {
  const page = read('app/checkin/page.tsx')
  const messages = read('lib/checkin-messages.ts')
  const panel = read('components/CheckInMessagesPanel.tsx')

  assert.match(page, /getCheckInMessage\(/)
  assert.match(page, /focusCommentId: notificationFocusId/)
  assert.match(page, /messagesForDisplay = selectedMessages\.some/)
  assert.match(messages, /focusCommentId\?: string/)
  assert.match(messages, /id: focusCommentId, messageId, isDeleted: false/)
  assert.match(messages, /getCheckInReplyStatus/)
  assert.match(panel, /focusErrorKind === 'load'/)
  assert.match(panel, /该回复已被删除/)
  assert.match(panel, /你暂时无法查看这条回复/)
})

test('通知回复状态区分有效、明确删除和查询失败', () => {
  const service = read('lib/notifications.ts')

  assert.match(service, /loadDailyNotificationComments/)
  assert.match(service, /暂时无法加载回复，请稍后重试/)
  assert.match(service, /该回复已被删除/)
  assert.match(service, /你暂时无法查看这条回复/)
  assert.match(service, /DailyMessage: \{ select: \{ isDeleted: true \} \}/)
})

test('个人主页挂号留言保留真实回复并提供展开入口', () => {
  assert.match(read('lib/profile-page.ts'), /parentId: true/)
  assert.match(read('app/api/profile/messages/route.ts'), /parentId: true/)
  assert.match(read('components/PublicUserModules.tsx'), /expandedRecentMessages/)
  assert.match(read('components/PublicUserModules.tsx'), /onToggleRecentMessage/)
  assert.match(read('components/ProfileDeferredModules.tsx'), /item\.comments\.length/)
})
