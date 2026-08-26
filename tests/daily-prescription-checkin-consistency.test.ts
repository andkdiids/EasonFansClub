import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日处方预览只展示图片和右上角关闭入口', () => {
  const source = read('components/games/SavePrescriptionButton.tsx')
  const css = read('app/globals.css')

  assert.doesNotMatch(source, /下载图片/)
  assert.doesNotMatch(source, /downloadBlob/)
  assert.doesNotMatch(source, /navigator\.canShare/)
  assert.match(source, /setPreview\(image\)/)
  assert.match(source, /prescription-preview-close/)
  assert.match(source, /右键点击图片，可复制或保存图片/)
  assert.match(source, /长按图片可保存或转发/)
  assert.match(source, /prescription-preview-hint-desktop/)
  assert.match(source, /prescription-preview-hint-mobile/)
  assert.doesNotMatch(source, /分享处方|分享给好友|分享到朋友圈/)
  assert.doesNotMatch(source, /navigator\.share|copyShareLink|configureWechatShare|shareMenuOpen|sharing/)
  assert.doesNotMatch(source, /window\.innerWidth/)
  assert.doesNotMatch(source, /onContextMenu|onTouchStart|preventDefault\(/)
  assert.doesNotMatch(css, /prescription-preview-actions|prescription-share-menu/)
  assert.match(css, /\.prescription-preview-hint-mobile \{ display:none; \}/)
  assert.match(css, /\.prescription-preview-hint-desktop \{ display:none; \}/)
  assert.doesNotMatch(css, /\.prescription-preview-backdrop[^}]*touch-action:/)
  assert.doesNotMatch(css, /\.prescription-preview-image[^}]*touch-action:/)
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
  assert.match(panel, /focusErrorKind === 'LOAD_FAILED'/)
  assert.match(panel, /该回复已被删除/)
  assert.match(panel, /你暂时无法查看这条回复/)
})

test('通知回复状态区分有效、明确删除和查询失败', () => {
  const service = read('lib/notifications.ts')

  assert.match(service, /loadDailyNotificationComments/)
  assert.match(service, /暂时无法加载回复，请稍后重试/)
  assert.match(service, /该回复已被删除或不可查看/)
  assert.match(service, /DailyMessage: \{\s*select: \{\s*isDeleted: true,[\s\S]*moderationStatus: true,[\s\S]*userId: true,[\s\S]*User: \{ select:/)
})

test('个人主页挂号留言保留真实回复并提供展开入口', () => {
  assert.match(read('lib/profile-page.ts'), /parentId: true/)
  assert.match(read('app/api/profile/messages/route.ts'), /parentId: true/)
  assert.match(read('components/PublicUserModules.tsx'), /expandedRecentMessages/)
  assert.match(read('components/PublicUserModules.tsx'), /onToggleRecentMessage/)
  assert.match(read('components/ProfileDeferredModules.tsx'), /item\.comments\.length/)
})
