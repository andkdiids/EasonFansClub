import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('移动底栏挂在 AppShell 顶层并统一使用安全区高度', () => {
  const shell = read('components/layout/AppShell.tsx')
  const css = read('app/globals.css')
  assert.match(shell, /<div className="app-main-area">[\s\S]*<\/div>\r?\n    <MobileNavigation/)
  assert.match(css, /--mobile-nav-height:\s*var\(--mobile-bottom-nav-height\)/)
  assert.match(css, /--mobile-nav-offset:\s*var\(--mobile-bottom-nav-total\)/)
  assert.match(css, /\.site-footer-info \{ padding-bottom: calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\)/)
  assert.match(css, /\.app-mobile-nav \{ position:fixed; z-index:var\(--layer-mobile-nav\); right:0; bottom:0; left:0/)
})

test('全局返回顶部使用被动监听、rAF 和 reduced motion', () => {
  const component = read('components/BackToTopButton.tsx')
  const shell = read('components/layout/AppShell.tsx')
  assert.match(shell, /<BackToTopButton \/>/)
  assert.match(component, /Math\.max\(500, window\.innerHeight\)/)
  assert.match(component, /requestAnimationFrame/)
  assert.match(component, /\{ passive: true \}/)
  assert.match(component, /prefers-reduced-motion: reduce/)
  assert.match(component, /aria-label="返回顶部"/)
})

test('通知创建时保存具体目标资源和 focus ID', () => {
  assert.match(read('app/api/posts/[postId]/replies/route.ts'), /\/posts\/\$\{postId\}\?focus=\$\{createdReply\.id\}/)
  assert.match(read('app/api/daily-messages/[messageId]/comments/route.ts'), /message=\$\{messageId\}&focus=\$\{created\.id\}/)
  assert.match(read('app/api/admin/feedback/[feedbackId]/replies/route.ts'), /\/feedback\/\$\{feedback\.id\}\?focus=\$\{reply\.id\}/)
  assert.match(read('app/api/profile-wall/route.ts'), /\/wall\?focus=\$\{created\.id\}/)
})

test('目标页面会展开、滚动、高亮并报告丢失内容', () => {
  for (const path of [
    'components/PostRepliesSection.tsx',
    'components/CheckInMessagesPanel.tsx',
    'app/feedback/FeedbackCenter.tsx',
    'components/ProfileWall.tsx',
  ]) {
    const source = read(path)
    assert.match(source, /scrollIntoView/)
    assert.match(source, /notification-focus-target/)
    assert.match(source, /该内容已被删除或无法查看/)
  }
  assert.match(read('components/CheckInMessagesPanel.tsx'), /setPage\(Math\.floor\(messageIndex \/ previewPageSize\) \+ 1\)/)
  assert.match(read('components/CheckInMessagesPanel.tsx'), /setExpandedReplies/)
})

test('通知中心直接回复复用现有业务 API 并防止重复发送', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(client, /直接回复/)
  assert.match(client, /\/api\/posts\/\$\{target\.resourceId\}\/replies/)
  assert.match(client, /\/api\/daily-messages\/\$\{target\.resourceId\}\/comments/)
  assert.match(client, /\/api\/feedback\/\$\{target\.resourceId\}\/replies/)
  assert.match(client, /url: '\/api\/profile-wall'/)
  assert.match(client, /disabled=\{sendingReply === itemKey/)
  assert.match(client, /setReplyDrafts/)
  assert.match(client, /回复成功/)
  assert.match(client, /notifications:return-state/)
})

test('服务端在展示回复入口前校验目标存在性、归属和反馈状态', () => {
  const service = read('lib/notifications.ts')
  assert.match(service, /prisma\.reply\.findMany/)
  assert.match(service, /prisma\.dailyMessageComment\.findMany/)
  assert.match(service, /prisma\.feedback\.findMany/)
  assert.match(service, /prisma\.profileWallMessage\.findMany/)
  assert.match(service, /feedback\.status === 'RESOLVED' \|\| feedback\.status === 'CLOSED'/)
  assert.match(service, /replyDisabledReason/)
})
