import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUnreadSummary, getNotificationCategory, parseNotificationCategory } from '../lib/notifications'
import { parseNotificationReplyTarget } from '../lib/notification-target'

const read = (path: string) => readFileSync(path, 'utf8')

test('留言墙通知进入独立「留言墙」分类，不再混入回复 / 点赞', () => {
  const service = read('lib/notifications.ts')
  const client = read('app/notifications/NotificationsClient.tsx')

  // 分类枚举与映射
  assert.match(service, /notificationCategoryValues = \[[^\]]*'wall'\]/)
  // 留言墙链接识别：/user/<uid>/wall
  assert.ok(service.includes("/^\\/user\\/\\d+\\/wall"))
  assert.match(client, /wall: '留言墙'/)
  assert.match(client, /wall: unreadSummary\.wall/)

  // 回复 / 点赞分类排除留言墙，留言墙单独成类
  assert.ok(service.includes("category === 'reply') return { type: 'REPLY', OR:"))
  assert.ok(service.includes("category === 'wall') return { AND:"))

  // 行为：留言墙链接归到 wall，普通回复仍归 reply
  assert.equal(getNotificationCategory('REPLY', '/user/00012/wall?focus=msg-1'), 'wall')
  assert.equal(getNotificationCategory('LIKE', '/user/00012/wall?focus=msg-1'), 'wall')
  assert.equal(getNotificationCategory('REPLY', '/posts/abc'), 'reply')
  assert.equal(getNotificationCategory('LIKE', null), 'like')
  // parseNotificationCategory 接受 wall
  assert.equal(parseNotificationCategory('wall'), 'wall')
})

test('通知中心点击留言墙回复携带正确的主人 userId、留言 id 与回复 commentId', () => {
  const postRoute = read('app/api/profile-wall/route.ts')
  const likeRoute = read('app/api/profile-wall/[messageId]/like/route.ts')

  // 生成通知时链接包含墙主人 uid（padStart 5 位）与 focus=留言/回复 id
  assert.ok(postRoute.includes("/wall?focus=${created.id}"))
  // 点赞留言墙同样携带 wall?focus=
  assert.ok(likeRoute.includes("/wall?focus=${messageId}"))

  // 解析出主人 userId（resourceId）与回复 commentId（parentId）
  const parsed = parseNotificationReplyTarget({
    id: 'n1',
    source: 'personal',
    type: 'REPLY',
    link: '/user/00012/wall?focus=comment-9',
    targetUrl: null,
  })
  assert.deepEqual(parsed, { kind: 'profile-wall', resourceId: '00012', parentId: 'comment-9' })
})

test('折叠的楼中楼回复不会误报「已删除」，留言存在时正确读取预览', () => {
  const service = read('lib/notifications.ts')

  // 水合时按数值比较主人 uid（消除 padStart 导致的字符串不匹配），不再恒报删除
  assert.doesNotMatch(service, /User_ProfileWallMessage_receiverIdToUser\.uid\) === target\.resourceId/)
  assert.match(service, /User_ProfileWallMessage_receiverIdToUser\.uid\) === String\(Number\(target\.resourceId\)\)/)
  // 查询按 deletedAt: null 判断存在性，与个人主页留言墙读取逻辑一致
  assert.ok(service.includes('where: { id: { in: wallTargets.map((target) => target.parentId) }, deletedAt: null }'))
  // 留言存在时返回真实预览，而非 REPLY_UNAVAILABLE_TEXT
  assert.ok(service.includes("if (target.kind === 'profile-wall') {"))
  assert.ok(service.includes('replyPreview: formatNotificationReplyPreview({ content: message.content, moderationStatus: message.moderationStatus })'))
})

test('留言墙通知读取与个人主页留言墙读取逻辑统一（删除 / 权限判断一致）', () => {
  const service = read('lib/notifications.ts')
  const wallRoute = read('app/api/profile-wall/route.ts')

  // 二者都以 deletedAt: null 作为「是否存在」的判据
  assert.ok(service.includes('deletedAt: null }'))
  assert.ok(wallRoute.includes('deletedAt: null'))
  // 不存在时统一提示
  assert.ok(service.includes('REPLY_UNAVAILABLE_TEXT'))
})

test('未读汇总正确统计留言墙分类，且不重复计入回复 / 点赞', () => {
  const summary = buildUnreadSummary({
    replies: 2,
    likes: 1,
    wall: 3,
    friendRequests: 1,
    messages: 0,
    feedback: 0,
    system: 1,
  }, 0, 0)

  // wall 从 replies/likes 中剥离后单独计数，total 不重复
  assert.equal(summary.wall, 3)
  assert.equal(summary.replies, 2)
  assert.equal(summary.likes, 1)
  // total = system(1) + replies(2) + likes(1) + friendRequests(1) + wall(3)
  assert.equal(summary.total, 8)
})
