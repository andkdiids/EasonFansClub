import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const helper = read('lib/like-notifications.ts')
const notifications = read('lib/notifications.ts')
const postLikeRoute = read('app/api/posts/[postId]/like/route.ts')
const replyLikeRoute = read('app/api/replies/[replyId]/like/route.ts')
const notificationsRoute = read('app/api/notifications/route.ts')
const client = read('app/notifications/NotificationsClient.tsx')

test('帖子和评论点赞使用不同的稳定聚合 key，并通过 upsert 保持一条通知', () => {
  assert.match(helper, /return `\$\{LIKE_NOTIFICATION_KEY_PREFIX\}\$\{kind\}:\$\{id\}`/)
  assert.match(helper, /notification\.upsert\(/)
  assert.match(postLikeRoute, /target: \{[\s\S]*kind: 'post',[\s\S]*id: postId/)
  assert.match(replyLikeRoute, /target: \{[\s\S]*kind: 'reply',[\s\S]*id: reply\.id/)
  assert.match(replyLikeRoute, /target: \{ kind: 'reply', id: reply\.id, link: `\/posts\/\$\{reply\.postId\}\?focus=\$\{reply\.id\}` \}/)
})

test('聚合通知人数来自 Like/ReplyLike 数据，并在分页前合并旧通知', () => {
  assert.match(helper, /tx\.like\.count\(/)
  assert.match(helper, /tx\.replyLike\.count\(/)
  assert.match(notifications, /reconcileLikeNotifications\(userId\)/)
  assert.match(notifications, /Promise\.allSettled\(\[/)
  assert.match(notifications, /loadLikeNotificationStats\(likeTargets\)/)
  assert.match(notifications, /formatLikeNotificationText\(actorName, likeCount, likeTarget\.kind\)/)
  assert.match(helper, /if \(snapshot\.count === 0\)/)
})

test('点击通知先等待已读，再跳转；聚合项按一条通知更新未读状态', () => {
  assert.match(client, /await markRead\(item\)/)
  assert.match(client, /await navigateToNotification\(item\)/)
  assert.match(client, /updateSummary\(\(current\) => decrementUnreadSummary\(current, \[item\]\)\)/)
})

test('点赞通知对账有界且通知事务不再并发读取两条查询', () => {
  assert.match(helper, /const rows = await tx\.notification\.findMany\(/)
  assert.match(helper, /take: MAX_LEGACY_NOTIFICATIONS_PER_TARGET/)
  assert.doesNotMatch(helper, /Promise\.all\(\[[\s\S]*tx\.notification\.findUnique/)
  assert.match(helper, /take: MAX_LIKE_RECONCILIATION_ROWS/)
  assert.match(helper, /slice\(0, MAX_LIKE_RECONCILIATION_TARGETS\)/)
  assert.match(notifications, /take: MAX_STALE_NOTIFICATION_RECONCILIATION_ROWS/)
})

test('清除全部由服务端按当前用户全量删除，不依赖当前页 ids', () => {
  assert.match(notificationsRoute, /const clearAll = body\?\.all === true/)
  assert.match(notificationsRoute, /notification\.deleteMany\(\{[\s\S]*where: \{ recipientId: guard\.user\.id \}/)
  assert.match(client, /body: JSON\.stringify\(\{ all: true \}\)/)
  assert.match(client, /setPagination\(\(current\) => \(\{ \.\.\.current, page: 1, total: 0, totalPages: 1 \}\)\)/)
})
