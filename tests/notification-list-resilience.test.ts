import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

// 需求：单条异常（帖子/评论/回复删除、点赞用户缺失、头像缺失、反馈无权限、留言墙缺失）
// 不应让整页标记为 degraded，从而避免前端误报「部分通知无法加载」黄条。
test('cosmetic enrichment failures do not flag the page as degraded', () => {
  const service = read('lib/notifications.ts')
  // 好友备注查询失败：只记录日志，不再 degraded = true
  const friendRemarksBlock = service.slice(
    service.indexOf("'list.friend-remarks'"),
    service.indexOf("'list.like-stats'"),
  )
  assert.doesNotMatch(friendRemarksBlock, /degraded\s*=\s*true/)
  // 点赞统计查询失败：只记录日志，不再 degraded = true
  const likeStatsBlock = service.slice(
    service.indexOf("'list.like-stats'"),
    service.indexOf('const personalById'),
  )
  assert.doesNotMatch(likeStatsBlock, /degraded\s*=\s*true/)
})

// 需求：逐条占位容错，并记录导致占位的 notificationId。
test('per-item fallback is collected and logged with notification ids', () => {
  const service = read('lib/notifications.ts')
  assert.match(service, /list\.item-fallback/)
  assert.match(service, /sampleNotificationIds/)
  assert.match(service, /fallbackItemIds\.push\(item\.id\)/)
  // 帖子/评论/回复/反馈/留言墙缺失都收集占位 ID
  const pushCount = (service.match(/fallbackItemIds\.push\(item\.id\)/g) || []).length
  assert.ok(pushCount >= 5, `expected at least 5 fallback capture sites, got ${pushCount}`)
})

// 需求：unread count 与 list 的 reply/like 筛选保持一致（反馈回复排除在回复/点赞之外）。
test('reply and like category filters exclude feedback links to match unread counts', () => {
  const service = read('lib/notifications.ts')
  // Prisma 筛选对象排除 /feedback/
  assert.match(service, /category === 'reply'\) return \{ type: 'REPLY'[\s\S]*startsWith: '\/feedback\/'/)
  assert.match(service, /category === 'like'\) return \{ type: 'LIKE'[\s\S]*startsWith: '\/feedback\/'/)
  // union 原始 SQL 同样排除 /feedback/（与 getUnreadSummary 一致）
  assert.match(service, /n\.type = 'REPLY' AND \(n\.link IS NULL OR \(n\.link NOT LIKE '%\/wall%' AND n\.link NOT LIKE '\/feedback\/%'\)\)/)
  assert.match(service, /n\.type = 'LIKE' AND \(n\.link IS NULL OR \(n\.link NOT LIKE '%\/wall%' AND n\.link NOT LIKE '\/feedback\/%'\)\)/)
})

// 需求：前端不在 degraded（有条目）时弹出「部分通知无法加载」黄条；仅整接口失败才提示。
test('notification client no longer renders a standalone degraded warning banner', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  // 独立的 loadWarning 黄条 JSX 块已移除
  assert.doesNotMatch(client, /\{loadWarning \? \(/)
  // 但整页失败（failed）或「degraded 且列表为空」仍升级为错误提示
  assert.match(client, /loadError \|\| \(loadWarning && notifications\.length === 0\)/)
  assert.match(client, /通知加载失败，请重试/)
})
