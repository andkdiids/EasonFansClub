import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

// 抽取 markModerationNotificationsRead 函数体，便于在"仅该函数"范围内断言范围约束。
function extractModerationFn(source: string): string {
  const match = source.match(/export async function markModerationNotificationsRead[\s\S]*?\n}/)
  return match ? match[0] : ''
}

test('审核结果批量已读函数只命中审核结果通知（ADMIN + /posts/ 或 /profile/stickers），不影响其他类型', () => {
  const notifications = read('lib/notifications.ts')
  const fn = extractModerationFn(notifications)

  assert.ok(fn.length > 0, 'markModerationNotificationsRead 函数应存在')

  // 仅更新未读行：幂等且不会重置已读时间。
  assert.match(fn, /isRead: false/)
  // 严格限定为审核结果通知：ADMIN 类型 + 帖子/表情包审核结果链接前缀。
  assert.match(fn, /type: 'ADMIN'/)
  assert.match(fn, /startsWith: '\/posts\/'/)
  assert.match(fn, /startsWith: '\/profile\/stickers'/)
  assert.match(fn, /data: \{ isRead: true, readAt \}/)

  // 范围绝不允许扩大为"该用户全部未读"或误伤其他通知类型。
  assert.doesNotMatch(fn, /where: \{\s*recipientId: userId,\s*isRead: false\s*\}/)
  assert.doesNotMatch(fn, /type: 'LIKE'|type: 'REPLY'|type: 'MESSAGE'|type: 'FRIEND_REQUEST'|type: 'FOLLOW'|type: 'SYSTEM'|type: 'BADGE'|type: 'BIRTHDAY_GREETING'/)
})

test('新增的 mark-moderation-read 接口鉴权并调用窄范围服务（不使用全部已读逻辑）', () => {
  const route = read('app/api/notifications/mark-moderation-read/route.ts')

  assert.match(route, /export async function POST/)
  assert.match(route, /requireUser\(\)/)
  assert.match(route, /markModerationNotificationsRead\(guard\.user\.id\)/)
  assert.match(route, /NextResponse\.json\(result\)/)
  assert.doesNotMatch(route, /markAllUnifiedNotificationsRead/)
})

test('审核中心两个入口页都挂载了挂载即清理的客户端组件', () => {
  const postPage = read('app/posts/[postId]/page.tsx')
  const stickersPage = read('app/profile/stickers/page.tsx')
  const component = read('components/MarkModerationReadOnMount.tsx')

  // 组件自身：client、调用接口、仅在清理 >0 条时刷新未读汇总。
  assert.match(component, /'use client'/)
  assert.match(component, /fetch\('\/api\/notifications\/mark-moderation-read', \{ method: 'POST' \}\)/)
  assert.match(component, /unread-summary:refresh/)

  // 帖子详情页：导入并渲染（登录用户时）。
  assert.match(postPage, /MarkModerationReadOnMount/)
  assert.match(postPage, /\{user \? <MarkModerationReadOnMount \/> : null\}/)

  // 我的表情包页：导入并渲染。
  assert.match(stickersPage, /MarkModerationReadOnMount/)
  assert.match(stickersPage, /<MarkModerationReadOnMount \/>/)
})
