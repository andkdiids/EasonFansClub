import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('全部已读：前端乐观更新 + keepalive 保证请求可靠', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  // 1) 点击后立即乐观更新（不等服务端返回）：先 setNotifications / setSummaryOverride 再发起请求。
  assert.match(client, /async function markAllRead\(\) \{/)
  assert.match(client, /setSummaryOverride\(zeroSummary\)/)
  assert.match(client, /setNotifications\(\(current\) => current\.map\(\(row\) => \(\{[\s\S]*?isRead: true/)

  // 2) 防重复点击：isMarkingAllRead 守卫，提前返回。
  assert.match(client, /async function markAllRead\(\) \{[\s\S]*?if \(isMarkingAllRead\) return/)

  // 3) 请求使用 keepalive，切页 / 关标签页仍可发出，避免"点了没反应"。
  assert.match(client, /fetch\('\/api\/notifications\/read-all',[\s\S]*?keepalive: true/)

  // 4) 失败回滚并提示用户，而不是静默恢复。
  assert.match(client, /setAllReadError\('操作失败，请重试'\)/)

  // 5) 按钮：处理中禁用 + 动态文案（处理中 / 已全部读 / 全部已读）。
  assert.match(client, /disabled=\{isMarkingAllRead \|\| unreadCount === 0\}/)
  assert.match(client, /isMarkingAllRead \? '处理中…' : unreadCount === 0 \? '已全部读' : '全部已读'/)
})

test('全部已读：后端一笔事务完成，不在热路径做对账', () => {
  const service = read('lib/notifications.ts')
  const route = read('app/api/notifications/read-all/route.ts')

  // 路由鉴权后调用服务。
  assert.match(route, /POST\(\)/)
  assert.match(route, /await markAllUnifiedNotificationsRead\(guard\.user\.id\)/)

  // 核心更新是一次 UPDATE WHERE (recipientId + isRead=false)，配合系统通知已读标记放进同一事务。
  assert.match(service, /prisma\.notification\.updateMany\(\{[\s\S]*?where: getUnreadNotificationWhere\(userId\),[\s\S]*?data: \{ isRead: true, readAt: now \}/)
  assert.match(service, /prisma\.\$transaction\(\[/)

  // 对账（清理历史幽灵通知 / 点赞聚合）属于维护工作，改为后台 void 执行，
  // 不再 await 阻塞用户点击响应。
  assert.doesNotMatch(service, /await reconcileLikeNotifications/)
  assert.doesNotMatch(service, /await reconcileStalePersonalNotifications/)
  assert.match(service, /void reconcileLikeNotifications\(userId\)\.catch/)
  assert.match(service, /void reconcileStalePersonalNotifications\(userId\)\.catch/)
})

test('全部已读：顶部角标（AppShell）与未读汇总同源，成功后归零', () => {
  const provider = read('components/NotificationProvider.tsx')
  const appShell = read('components/layout/AppShell.tsx')
  const client = read('app/notifications/NotificationsClient.tsx')

  // 顶部角标来自 Provider 暴露的 useNotificationSummary（与未读汇总同源）。
  assert.match(provider, /export function useNotificationSummary\(\)/)
  assert.match(appShell, /const \{ summary: currentUnreadSummary \} = useNotificationSummary\(\)/)

  // 全部已读成功后：刷新权威汇总 + 清除本地覆盖，使顶部角标归零。
  assert.match(client, /await refreshUnreadSummary\(\)/)
  assert.match(client, /setSummaryOverride\(null\)/)
})
