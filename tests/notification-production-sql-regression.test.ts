import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildUnreadSummary,
  getNotificationCategory,
  getNotificationCategoryFilter,
  getUnreadNotificationWhere,
} from '../lib/notifications'
import { describeNotificationError } from '../lib/notification-errors'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/notifications.ts')

function summaryBlock() {
  const start = service.indexOf('async function loadUnreadSummary')
  const end = service.indexOf('export async function getUnreadNotificationCount')
  assert.ok(start >= 0 && end > start)
  return service.slice(start, end)
}

function unifiedListBlock() {
  const start = service.indexOf('export async function listUnifiedNotificationsPage')
  const end = service.indexOf('export async function listUnifiedNotifications(', start)
  assert.ok(start >= 0 && end > start)
  return service.slice(start, end)
}

function unifiedUnionBlock() {
  const list = unifiedListBlock()
  const start = list.indexOf('rows = await prisma.$queryRaw')
  const end = list.indexOf('    `)', start)
  assert.ok(start >= 0 && end > start)
  return list.slice(start, end)
}

test('canReview=false 使用稳定的 review=0 SQL 片段', () => {
  const summary = summaryBlock()
  assert.ok(summary.includes(': Prisma.sql`0`'))
  assert.ok(summary.includes('${reviewCountSql} AS review'))
  assert.doesNotMatch(summary, /COUNT\(CASE WHEN \$\{canReview \?/)
})

test('canReview=true 使用完整合法的 review CASE 表达式', () => {
  const summary = summaryBlock()
  assert.match(summary, /COUNT\(\s*CASE\s+WHEN/)
  assert.match(summary, /THEN 1\s+END/)
  assert.match(summary, /n\.\\`key\\`/)
})

test('post-review ADMIN 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/posts/review', 'post-review:p1'), 'review')
})

test('sticker-pack-review 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/stickers', 'sticker-pack-review:pack1'), 'review')
})

test('sticker-pack-resubmit 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/stickers', 'sticker-pack-resubmit:pack1'), 'review')
})

test('today-review 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/today', 'today-review:item1'), 'review')
})

test('feedback-new 不归入系统', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/feedback', 'feedback-new:f1'), 'feedback')
  assert.notEqual(getNotificationCategory('ADMIN', '/admin/feedback', 'feedback-new:f1'), 'system')
})

test('FEEDBACK 类型归入反馈', () => {
  assert.equal(getNotificationCategory('FEEDBACK', '/admin/feedback/f1', null), 'feedback')
})

test('普通活动报名 ACTIVITY 归入系统', () => {
  assert.equal(getNotificationCategory('ACTIVITY', '/activities/a1', 'activity-registration-success:a1:u1'), 'system')
})

test('全部分类使用列对齐的派生表 UNION，并只按外层输出别名排序', () => {
  const union = unifiedUnionBlock()
  const selectProjections = [...union.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+(Notification n|SystemNotification sn)/g)]
  assert.equal(selectProjections.length, 2)
  assert.deepEqual(selectProjections.map((match) => [...match[1].matchAll(/\bAS\s+(?!CHAR\b)([A-Za-z][A-Za-z0-9_]*)/g)].map((alias) => alias[1])), [
    ['id', 'source', 'isRead', 'createdAt'],
    ['id', 'source', 'isRead', 'createdAt'],
  ])
  assert.match(union, /FROM \(\s*SELECT/)
  assert.match(union, /\) AS unified/)
  assert.match(union, /ORDER BY unified\.isRead ASC, unified\.createdAt DESC, unified\.source ASC, unified\.id ASC/)
  assert.doesNotMatch(union, /ORDER BY\s+(?:n|sn|snr)\./)
  assert.match(union, /CAST\(n\.id AS CHAR\(191\)\)/)
  assert.match(union, /CAST\(sn\.id AS CHAR\(191\)\)/)
})

test('全部分类的 count/list 共享分类入口、已读语义和系统通知读取状态', () => {
  const list = unifiedListBlock()
  const union = unifiedUnionBlock()
  assert.match(list, /const personalCategory = getNotificationCategoryFilter\(category, canReview\)/)
  assert.match(list, /const personalCategorySql = getPersonalNotificationCategorySql\(category, canReview\)/)
  assert.match(list, /const systemWhere = getSystemNotificationWhere\(now, category, userId, options\.unreadOnly\)/)
  assert.match(list, /const systemCategorySql = getSystemNotificationCategorySql\(category\)/)
  assert.match(list, /readAt: null/)
  assert.match(service, /SystemNotificationRead: \{ none: \{ userId \} \}/)
  assert.match(union, /LEFT JOIN SystemNotificationRead snr[\s\S]*snr\.notificationId = sn\.id AND snr\.userId = \$\{userId\}/)
  assert.match(union, /CASE WHEN snr\.id IS NULL THEN 0 ELSE 1 END AS isRead/)
  assert.match(union, /sn\.type <> 'UPDATE'/)
  assert.match(service, /case 'all': return canReview[\s\S]*n\.type NOT IN \('MESSAGE', 'REVIEW'\)/)
})

test('系统分类的汇总、计数和 hydration 共享有效期、分类与已读条件', () => {
  const summary = summaryBlock()
  const list = unifiedListBlock()
  assert.match(summary, /getSystemNotificationWhere\(now, 'system', userId, true\)/)
  assert.match(summary, /getSystemNotificationWhere\(now, 'feedback', userId, true\)/)
  assert.match(list, /const systemWhere = getSystemNotificationWhere\(now, category, userId, options\.unreadOnly\)/)
  assert.match(list, /prisma\.systemNotification\.count\(\{ where: getSystemNotificationWhere\(now, category, userId, true\) \}\)/)
  assert.match(list, /where: \{ id: \{ in: systemIds \}, \.\.\.getSystemNotificationWhere\(now, category, userId\) \}/)
  assert.match(service, /category === 'system'\) return \{ AND: \[\{ OR:/)
})

test('系统分类 UNION 使用广播通知过滤和 SystemNotificationRead，失败时走明确的系统查询错误路径', () => {
  const list = unifiedListBlock()
  const union = unifiedUnionBlock()
  const route = read('app/api/notifications/route.ts')
  assert.match(union, /AND sn\.type <> 'UPDATE'/)
  assert.match(service, /sn\.link IS NULL OR sn\.link NOT LIKE '\/feedback\/%'/)
  assert.match(union, /LEFT JOIN SystemNotificationRead snr[\s\S]*snr\.notificationId = sn\.id AND snr\.userId = \$\{userId\}/)
  assert.match(union, /CASE WHEN snr\.id IS NULL THEN 0 ELSE 1 END AS isRead/)
  assert.match(list, /category === 'system' \? 'list\.system-query' : 'list\.union-query'/)
  assert.match(list, /unavailablePage[\s\S]*failed: true/)
  assert.match(route, /if \(result\.failed\)[\s\S]*status: 503/)
})

test('REPLY 归入回复', () => {
  assert.equal(getNotificationCategory('REPLY', '/posts/p1', 'reply:r1'), 'reply')
})

test('LIKE 归入点赞', () => {
  assert.equal(getNotificationCategory('LIKE', '/posts/p1', 'like:p1:u1'), 'like')
})

test('readAt=null 是普通通知的未读过滤条件', () => {
  assert.deepEqual(getUnreadNotificationWhere('user-1'), { recipientId: 'user-1', readAt: null })
})

test('readAt 非空不会被普通未读过滤器选中', () => {
  const where = getUnreadNotificationWhere('user-1')
  assert.equal(where.readAt, null)
  assert.doesNotMatch(JSON.stringify(where), /isRead/)
})

test('单条已读接口写入 readAt 并限定 recipientId', () => {
  const route = read('app/api/notifications/[notificationId]/read/route.ts')
  assert.match(route, /markUnifiedNotificationReadWithState\(guard\.user\.id/)
  assert.match(service, /where: getUnreadNotificationWhere\(userId, \{ id \}\)/)
  assert.match(service, /data: \{ isRead: true, readAt \}/)
})

test('全部已读使用 readAt 批量更新', () => {
  assert.match(service, /markAllUnifiedNotificationsRead\(userId: string\)/)
  assert.match(service, /where: getUnreadNotificationWhere\(userId\)[\s\S]*data: \{ isRead: true, readAt: now \}/)
})

test('普通用户不能看到审核分类', () => {
  assert.deepEqual(getNotificationCategoryFilter('review'), { id: { in: [] } })
})

test('具备审核权限的用户可以看到审核分类', () => {
  assert.match(JSON.stringify(getNotificationCategoryFilter('review', true)), /REVIEW/)
})

test('分类 count 与列表 SQL 使用相同的反馈/审核/系统判定片段', () => {
  const feedbackFilter = JSON.stringify(getNotificationCategoryFilter('feedback'))
  const reviewFilter = JSON.stringify(getNotificationCategoryFilter('review', true))
  const systemFilter = JSON.stringify(getNotificationCategoryFilter('system', true))
  assert.match(feedbackFilter, /FEEDBACK/)
  assert.match(reviewFilter, /post-review:/)
  assert.match(systemFilter, /FEEDBACK/)
  assert.match(service, /case 'feedback':[\s\S]*n\.type = 'FEEDBACK'/)
  assert.match(service, /case 'review':[\s\S]*n\.type = 'REVIEW'/)
  assert.match(service, /case 'system':[\s\S]*n\.type NOT IN/)
})

test('私信 unread 不计入 Notification.total', () => {
  const summary = buildUnreadSummary({
    replies: 1,
    likes: 0,
    friendRequests: 0,
    messages: 9,
    feedback: 0,
    system: 0,
    review: 0,
  }, 0, 9)
  assert.equal(summary.directMessages, 9)
  assert.equal(summary.total, 1)
})

test('所有 Notification.key 原生 SQL 引用均使用反引号', () => {
  assert.doesNotMatch(service, /n\.key\b/)
  assert.doesNotMatch(service, /COALESCE\(n\.key/)
  assert.ok(service.includes('n.\\`key\\`'))
})

test('统一列表失败时返回安全分页，并让前端隐藏过期分页', () => {
  const list = unifiedListBlock()
  const client = read('app/notifications/NotificationsClient.tsx')
  const page = read('app/notifications/page.tsx')
  const refreshStart = client.indexOf('const refreshNotifications = useCallback(() => {')
  const refreshEnd = client.indexOf('  useEffect(() => {', refreshStart)
  assert.ok(refreshStart >= 0)
  assert.ok(refreshEnd > refreshStart)
  const refresh = client.slice(refreshStart, refreshEnd)
  assert.match(list, /const unavailablePage = \(\): UnifiedNotificationPage => \{[\s\S]*total: 0,[\s\S]*page: 1,[\s\S]*totalPages: 1,[\s\S]*failed: true/)
  assert.match(client, /setPagination\(\{ page: 1, pageSize: NOTIFICATION_LIST_PAGE_SIZE, total: 0, totalPages: 1 \}\)/)
  assert.doesNotMatch(refresh, /if \(!response\.ok\) \{\s*setNotifications\(\[\]\)/)
  assert.doesNotMatch(refresh, /if \(data\.failed\) \{\s*setNotifications\(\[\]\)/)
  assert.doesNotMatch(refresh, /if \(degradedWithoutItems\) \{\s*setNotifications\(\[\]\)/)
  assert.match(client, /!loadError && !\(loadWarning && notifications\.length === 0\) && pagination\.totalPages > 1/)
  assert.match(page, /notifications\.failed \|\| \(notifications\.degraded && notifications\.items\.length === 0\)/)
  assert.match(read('app/api/notifications/route.ts'), /if \(result\.failed\)[\s\S]*status: 503/)
})

test('通知 SQL 日志单独提取 MySQL 错误码且不暴露错误元数据', () => {
  const error = Object.assign(new Error('Raw query failed. Code: 1064. Message: syntax error'), {
    code: 'P2010',
    meta: { query: 'SELECT ...', token: 'should-not-log' },
  })
  const details = describeNotificationError(error)
  assert.equal(details.errorCode, 'P2010')
  assert.equal(details.mysqlCode, '1064')
  assert.doesNotMatch(JSON.stringify(details), /should-not-log|SELECT \.\.\./)
})

test('核心汇总或列表查询失败时不伪造未读 0', () => {
  assert.match(service, /unread-summary\.personal-query'[\s\S]*throw personalResult\.reason/)
  assert.match(service, /const getRequiredCount[\s\S]*throw result\.reason/)
  assert.match(service, /return \{[\s\S]*unreadCount: personalUnread \+ systemUnread,[\s\S]*failed: true/)
  assert.match(read('app/layout.tsx'), /Do not turn an unavailable core query into a false "0 unread" badge/)
  assert.match(read('components/NotificationProvider.tsx'), /summaryAvailable/)
  assert.match(read('app/notifications/NotificationsClient.tsx'), /unreadCount === null \? '暂不可用'/)
  assert.match(read('app/notifications/NotificationsClient.tsx'), /!loadError && !\(loadWarning && notifications\.length === 0\) && pagination\.totalPages > 1/)
  assert.match(read('components/FriendDock.tsx'), /unreadSummaryAvailable/)
  assert.match(read('components/UserNotificationMenu.tsx'), /summaryAvailable && summary\.total/)
})
