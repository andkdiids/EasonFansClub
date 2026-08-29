import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Topbar 用户菜单支持外部点击、Esc、路由变化和入口点击关闭', () => {
  const topbar = read('components/layout/Topbar.tsx')
  assert.match(topbar, /menuRootRef/)
  assert.match(topbar, /document\.addEventListener\('pointerdown'/)
  assert.match(topbar, /event\.key === 'Escape'/)
  assert.match(topbar, /setMenuOpen\(false\)[\s\S]*\[pathname\]/)
  assert.match(topbar, /onClick=\{\(\) => setMenuOpen\(false\)\}/)
})

test('AppShell 与消息中心共用真实统一未读计数', () => {
  const layout = read('app/layout.tsx')
  const provider = read('components/NotificationProvider.tsx')
  const notificationsPage = read('app/notifications/page.tsx')
  const notificationsClient = read('app/notifications/NotificationsClient.tsx')
  assert.match(layout, /getUnreadSummary/)
  assert.match(layout, /<NotificationProvider/)
  assert.match(provider, /\/api\/notifications\/unread-summary/)
  assert.match(provider, /unread-summary:refresh/)
  assert.doesNotMatch(notificationsPage, /getUnreadSummary/)
  assert.doesNotMatch(notificationsPage, /UserPersonalizationSettings|checkinMoodEnabled/)
  assert.doesNotMatch(notificationsClient, /UserPersonalizationSettings|initialCheckinMoodEnabled/)
  assert.match(notificationsClient, /source: 'system'/)
})

test('个性化签到设置只出现在个人资料相关页面', () => {
  const profile = read('app/profile/page.tsx')
  assert.doesNotMatch(profile, /UserPersonalizationSettings|ProfileStatsGrid|ProfileCheckInCalendar|checkinMoodEnabled/)
})

test('统一图片查看器支持原图、滚轮、Pointer 缩放、长图拖动和退出清理', () => {
  const viewer = read('components/ImageViewer.tsx')
  const post = read('app/posts/[postId]/page.tsx')
  const carousel = read('components/PostMediaCarousel.tsx')
  const replies = read('components/PostRepliesSection.tsx')
  assert.match(viewer, /createPortal/)
  assert.match(viewer, /overflow-hidden/)
  assert.match(viewer, /onWheel/)
  assert.match(viewer, /onPointerMove/)
  assert.match(viewer, /touch-none/)
  assert.match(viewer, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(viewer, /document\.body\.style\.overflow = previousBodyOverflow/)
  assert.match(post, /<PostMediaCarousel/)
  assert.match(carousel, /<ImageViewer/)
  assert.match(carousel, /SWIPE_ACTIVATION_THRESHOLD_PX = 12/)
  assert.match(carousel, /SWIPE_COMMIT_THRESHOLD_PX = 48/)
  assert.match(carousel, /scrollToIndex\(targetIndex\)/)
  assert.match(read('app/globals.css'), /\.post-media-carousel-viewport \{[^}]*touch-action:pan-y/)
  assert.match(replies, /<ImageViewer/)
  assert.match(replies, /id=\{`reply-\$\{reply\.id\}`\}/)
})
