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
  const shell = read('components/layout/AppShell.tsx')
  const notificationsPage = read('app/notifications/page.tsx')
  const notificationsClient = read('app/notifications/NotificationsClient.tsx')
  assert.match(layout, /getUnreadNotificationCount/)
  assert.match(shell, /\/api\/notifications\/unread-count/)
  assert.match(shell, /unread-summary:refresh/)
  assert.match(notificationsPage, /getUnreadNotificationCount/)
  assert.doesNotMatch(notificationsPage, /UserPersonalizationSettings|checkinMoodEnabled/)
  assert.doesNotMatch(notificationsClient, /UserPersonalizationSettings|initialCheckinMoodEnabled/)
  assert.match(notificationsClient, /source: 'system'/)
})

test('个性化签到设置只出现在个人资料相关页面', () => {
  const profile = read('app/profile/page.tsx')
  assert.doesNotMatch(profile, /UserPersonalizationSettings|ProfileStatsGrid|ProfileCheckInCalendar|checkinMoodEnabled/)
})

test('统一图片查看器支持原图、滚轮、触摸缩放、长图滚动和退出清理', () => {
  const viewer = read('components/ImageViewer.tsx')
  const post = read('app/posts/[postId]/page.tsx')
  const replies = read('components/PostRepliesSection.tsx')
  assert.match(viewer, /createPortal/)
  assert.match(viewer, /overflow-auto/)
  assert.match(viewer, /onWheel/)
  assert.match(viewer, /onTouchMove/)
  assert.match(viewer, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(viewer, /document\.body\.style\.overflow = previousOverflow/)
  assert.match(post, /<ImageViewer/)
  assert.match(replies, /<ImageViewer/)
  assert.match(replies, /id=\{`reply-\$\{reply\.id\}`\}/)
})
