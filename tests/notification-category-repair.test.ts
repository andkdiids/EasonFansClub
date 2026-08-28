import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildUnreadSummary,
  getNotificationCategory,
  getNotificationCategoryFilter,
  notificationCategoryValues,
  parseNotificationCategory,
} from '../lib/notifications'

const read = (path: string) => readFileSync(path, 'utf8')

test('通知分类只保留最终一级分类，并将留言墙互动按真实语义归类', () => {
  assert.deepEqual(notificationCategoryValues, ['all', 'reply', 'like', 'application', 'feedback', 'system', 'review'])
  assert.equal(parseNotificationCategory('friend'), 'application')
  assert.equal(parseNotificationCategory('messages'), 'all')
  assert.equal(parseNotificationCategory('wall'), 'all')

  assert.equal(getNotificationCategory('REPLY', '/user/00012/wall?focus=msg-1'), 'reply')
  assert.equal(getNotificationCategory('LIKE', '/user/00012/wall?focus=msg-1'), 'like')
  assert.equal(getNotificationCategory('FEEDBACK', '/admin/feedback', 'feedback-new:f1'), 'feedback')
  assert.equal(getNotificationCategory('REVIEW', '/admin/posts/review', 'post-review:p1'), 'review')
  assert.equal(getNotificationCategory('ADMIN', '/admin/posts/review', 'post-review:p1'), 'review')

  const categories = [
    getNotificationCategory('FEEDBACK', '/admin/feedback', 'feedback-new:f1'),
    getNotificationCategory('REVIEW', '/admin/posts/review', 'post-review:p1'),
    getNotificationCategory('REPLY', '/user/00012/wall?focus=msg-1'),
    getNotificationCategory('LIKE', '/user/00012/wall?focus=msg-1'),
  ]
  assert.equal(new Set(categories).size, categories.length)
})

test('分类查询服务端按权限隔离审核，并排除私信与旧审核提醒的系统重复口径', () => {
  const unauthorizedReview = getNotificationCategoryFilter('review')
  assert.deepEqual(unauthorizedReview, { id: { in: [] } })

  const reviewFilter = getNotificationCategoryFilter('review', true)
  assert.match(JSON.stringify(reviewFilter), /REVIEW/)
  const normalAllFilter = getNotificationCategoryFilter('all')
  assert.match(JSON.stringify(normalAllFilter), /MESSAGE/)
  assert.match(JSON.stringify(normalAllFilter), /post-review:/)
  const systemFilter = getNotificationCategoryFilter('system', true)
  assert.match(JSON.stringify(systemFilter), /FEEDBACK/)
  assert.match(JSON.stringify(systemFilter), /REVIEW/)

  const route = read('app/api/notifications/route.ts')
  const summaryRoute = read('app/api/notifications/unread-summary/route.ts')
  const countRoute = read('app/api/notifications/unread-count/route.ts')
  assert.match(route, /const reviewGuard = await requireAdmin\(\)/)
  assert.match(route, /listUnifiedNotificationsPage\(guard\.user\.id, \{ unreadOnly, page: requestedPage, pageSize, category, canReview \}\)/)
  assert.match(summaryRoute, /hasAdminPermission\(guard\.user\)/)
  assert.match(countRoute, /hasAdminPermission\(guard\.user\)/)
})

test('未读汇总把反馈与审核各计一次，私信继续返回独立数量但不进入通知总数', () => {
  const summary = buildUnreadSummary({
    replies: 6,
    likes: 17,
    friendRequests: 1,
    messages: 12,
    feedback: 2,
    system: 4,
    review: 3,
  }, 0, 12)

  assert.equal(summary.replies, 6)
  assert.equal(summary.likes, 17)
  assert.equal(summary.feedback, 2)
  assert.equal(summary.review, 3)
  assert.equal(summary.directMessages, 12)
  assert.equal(summary.messages, 12)
  assert.equal(summary.total, 33)
  assert.equal(summary.notifications, 33)
  assert.equal(summary.wall, 0)
})

test('通知中心全部已读不消费聊天未读游标', () => {
  const service = read('lib/notifications.ts')
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.doesNotMatch(service, /conversationParticipant\.updateMany\([\s\S]*lastReadAt: now/)
  assert.match(client, /directMessages: unreadSummary\.directMessages/)
  assert.match(client, /messages: unreadSummary\.messages/)
})

test('反馈与待审核提醒从创建入口开始使用独立类型，并保留幂等写入', () => {
  const feedback = read('app/api/feedback/route.ts')
  const posts = read('app/api/posts/route.ts')
  const postEdit = read('app/api/posts/[postId]/route.ts')
  const today = read('app/api/today/route.ts')
  const stickers = read('app/api/stickers/my/[packId]/submit/route.ts')
  const stickerService = read('lib/sticker-center.ts')

  assert.match(feedback, /type: 'FEEDBACK'/)
  assert.doesNotMatch(feedback, /type: 'ADMIN'/)
  for (const source of [posts, postEdit, today, stickers, stickerService]) {
    assert.match(source, /type: 'REVIEW'/)
    assert.match(source, /skipDuplicates: true/)
  }
  assert.match(posts, /AdminPermission: \{ some: \{ permissionKey: 'post_manage'/)
  assert.match(today, /permissionKey: 'today_manage'/)
  assert.match(stickers, /permissionKey: 'sticker_manage'/)
})

test('通知中心只渲染普通分类与管理员审核分类，Tabs 始终横向单行可滚动', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const css = read('app/globals.css')
  const menu = read('components/UserNotificationMenu.tsx')

  for (const label of ["all: '全部'", "reply: '回复'", "like: '点赞'", "application: '申请'", "feedback: '反馈'", "system: '系统'", "review: '审核'"]) {
    assert.match(client, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(client, /messages: '私信'/)
  assert.doesNotMatch(client, /wall: '留言墙'/)
  assert.match(client, /category !== 'review'/)
  assert.match(client, /notification-category-tabs/)
  assert.match(css, /\.notification-category-tabs[\s\S]*flex-wrap: nowrap/)
  assert.match(css, /\.notification-category-tabs[\s\S]*overflow-x: auto/)
  assert.match(css, /\.notification-category-tab[\s\S]*white-space: nowrap/)
  assert.match(menu, /href="\/friends"/)
})
